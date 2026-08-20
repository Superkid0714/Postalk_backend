import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  buildSessionSummary,
  getDefaultSessionCategory,
  getRequestedShot,
  normalizeAdSessionWorkflow,
} from "@/lib/ad-session";
import { processGenerationJobById } from "@/lib/generation/process-job";
import { processVideoJobById } from "@/lib/generation/process-video-job";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;

  if (!isUuid(sessionId)) {
    return errorResponse("Invalid session id", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const supabase = getSupabaseAdminClient();
  const { data: session, error } = await supabase
    .from("ad_creation_sessions")
    .select(`
      id,
      store_id,
      ad_type,
      intro_text,
      status,
      style_preset,
      workflow,
      submission_id,
      generation_job_id,
      created_at,
      updated_at,
      stores (
        id,
        market_name,
        store_name,
        owner_name,
        category,
        description
      ),
      ad_creation_session_assets (
        id,
        shot_key,
        asset_type,
        storage_bucket,
        file_path,
        sort_order,
        review_passed,
        review_score,
        review_summary,
        review_feedback,
        created_at
      )
    `)
    .eq("id", sessionId)
    .single();

  if (error || !session) {
    return errorResponse("Ad session not found", 404, {
      code: "AD_SESSION_NOT_FOUND",
    });
  }

  if (session.generation_job_id && (session.status === "generating" || session.status === "ready_for_generation")) {
    try {
      if (session.ad_type === "video") {
        await processVideoJobById(session.generation_job_id);
      } else {
        await processGenerationJobById(session.generation_job_id);
      }
    } catch {
      // Persisted state is returned below.
    }
  }

  const workflow = normalizeAdSessionWorkflow(session.workflow);
  const store = Array.isArray(session.stores) ? session.stores[0] : session.stores;

  if (!store) {
    return errorResponse("Store not found for session", 404, {
      code: "STORE_NOT_FOUND",
    });
  }

  const category = getDefaultSessionCategory(store.category);
  const currentRequest =
    session.status === "collecting" ? getRequestedShot(workflow, category) : null;

  let generation: Record<string, unknown> | null = null;

  if (session.generation_job_id) {
    const { data: job } = await supabase
      .from("generation_jobs")
      .select(`
        id,
        status,
        style_preset,
        model_name,
        failure_reason,
        result_payload,
        result_storage_bucket,
        result_file_path,
        completed_at
      `)
      .eq("id", session.generation_job_id)
      .single();

    if (job) {
      if (job.status === "completed" && session.status !== "completed") {
        await supabase
          .from("ad_creation_sessions")
          .update({
            status: "completed",
          })
          .eq("id", session.id);
        session.status = "completed";
      }

      if (job.status === "failed" && session.status !== "failed") {
        await supabase
          .from("ad_creation_sessions")
          .update({
            status: "failed",
            workflow: {
              ...workflow,
              lastFailureReason: job.failure_reason,
            },
          })
          .eq("id", session.id);
        session.status = "failed";
      }

      let resultUrl: string | null = null;
      let generatedAssets: Array<{
        assetId: string | null;
        filePath: string | null;
        promptKey: string | null;
        url: string | null;
      }> = [];

      if (job.result_storage_bucket && job.result_file_path) {
        const { data: signed } = await supabase.storage
          .from(job.result_storage_bucket)
          .createSignedUrl(job.result_file_path, 60 * 60);

        resultUrl = signed?.signedUrl ?? null;
      }

      if (job.result_payload && typeof job.result_payload === "object") {
        const payload = job.result_payload as {
          imageCount?: unknown;
          templateSlots?: unknown;
          generatedImages?: Array<{
            assetId?: unknown;
            filePath?: unknown;
            promptKey?: unknown;
          }>;
        };

        if (Array.isArray(payload.generatedImages)) {
          generatedAssets = await Promise.all(
            payload.generatedImages.map(async (item) => {
              const filePath =
                typeof item.filePath === "string" ? item.filePath : null;
              const assetId =
                typeof item.assetId === "string" ? item.assetId : null;
              const promptKey =
                typeof item.promptKey === "string" ? item.promptKey : null;

              if (!filePath || !job.result_storage_bucket) {
                return {
                  assetId,
                  filePath,
                  promptKey,
                  url: null,
                };
              }

              const { data: signed } = await supabase.storage
                .from(job.result_storage_bucket)
                .createSignedUrl(filePath, 60 * 60);

              return {
                assetId,
                filePath,
                promptKey,
                url: signed?.signedUrl ?? null,
              };
            }),
          );
        }

        generation = {
          jobId: job.id,
          status: job.status,
          stylePreset: job.style_preset,
          modelName: job.model_name,
          failureReason: job.failure_reason,
          imageCount:
            typeof payload.imageCount === "number" ? payload.imageCount : null,
          resultUrl,
          generatedAssets,
          templateSlots:
            payload.templateSlots &&
            typeof payload.templateSlots === "object" &&
            !Array.isArray(payload.templateSlots)
              ? payload.templateSlots
              : null,
          completedAt: job.completed_at,
        };
      } else {
        generation = {
          jobId: job.id,
          status: job.status,
          stylePreset: job.style_preset,
          modelName: job.model_name,
          failureReason: job.failure_reason,
          resultUrl,
          generatedAssets,
          completedAt: job.completed_at,
        };
      }
    }
  }

  let submission: Record<string, unknown> | null = null;

  if (session.submission_id) {
    const { data: linkedSubmission } = await supabase
      .from("submissions")
      .select("id, caption, hashtags, status")
      .eq("id", session.submission_id)
      .single();

    if (linkedSubmission) {
      submission = {
        submissionId: linkedSubmission.id,
        caption: linkedSubmission.caption,
        hashtags: linkedSubmission.hashtags,
        status: linkedSubmission.status,
      };
    }
  }

  return successResponse(
    {
      sessionId: session.id,
      adType: session.ad_type,
      status: session.status,
      stylePreset: session.style_preset,
      introText: session.intro_text,
      intro: {
        menuIntro: workflow.menuIntro ?? null,
        storeSpecialty: workflow.storeSpecialty ?? null,
        combinedText: session.intro_text,
      },
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      store: buildSessionSummary(store, workflow),
      draft: {
        caption: workflow.draftCaption ?? null,
        hashtags: workflow.draftHashtags ?? [],
        preparedAt: workflow.draftPreparedAt ?? null,
        assetCount: workflow.draftAssetCount ?? 0,
        promptCount: workflow.draftCarouselPrompts?.length ?? 0,
      },
      currentRequest: currentRequest
        ? {
            response: "success",
            status: session.status,
            shotKey: currentRequest.shotKey,
            assetType: currentRequest.assetType,
            prompt: currentRequest.prompt,
            helperText: currentRequest.helperText,
          }
        : null,
      collectedAssets: (session.ad_creation_session_assets ?? []).map((asset) => ({
        assetId: asset.id,
        shotKey: asset.shot_key,
        assetType: asset.asset_type,
        filePath: asset.file_path,
        sortOrder: asset.sort_order,
        reviewPassed: asset.review_passed,
        reviewScore: asset.review_score,
        reviewSummary: asset.review_summary,
        reviewFeedback: asset.review_feedback,
        createdAt: asset.created_at,
      })),
      submission,
      generation,
    },
    "Ad session loaded",
  );
}
