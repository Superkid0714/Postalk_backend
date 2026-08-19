import { after } from "next/server";
import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  buildSessionSummary,
  getDefaultSessionCategory,
  getNextShot,
  getRequestedShot,
  normalizeAdSessionWorkflow,
} from "@/lib/ad-session";
import { createSubmissionAndGenerationJobFromSession } from "@/lib/ad-session-generation";
import { prepareAdSessionDrafts } from "@/lib/ad-session-preparation";
import { reviewPhotoAsset } from "@/lib/ai/photo-review";
import { processGenerationJobById } from "@/lib/generation/process-job";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

type SubmitSessionPhotoBody = {
  bucket?: string;
  filePath?: string;
  fileName?: string;
  mimeType?: string | null;
  fileSize?: number | null;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;

  if (!isUuid(sessionId)) {
    return errorResponse("Invalid session id", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  let body: SubmitSessionPhotoBody;

  try {
    body = (await request.json()) as SubmitSessionPhotoBody;
  } catch {
    return errorResponse("Invalid JSON body", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const details: Array<{ field: string; reason: string }> = [];

  if (!body.bucket?.trim()) {
    details.push({
      field: "bucket",
      reason: "bucket is required",
    });
  }

  if (!body.filePath?.trim()) {
    details.push({
      field: "filePath",
      reason: "filePath is required",
    });
  }

  if (details.length > 0) {
    return errorResponse("Invalid request body", 400, {
      code: "VALIDATION_ERROR",
      details,
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
        sort_order
      )
    `)
    .eq("id", sessionId)
    .single();

  if (error || !session) {
    return errorResponse("Ad session not found", 404, {
      code: "AD_SESSION_NOT_FOUND",
    });
  }

  if (session.status !== "collecting") {
    return errorResponse("This session is no longer accepting photos", 400, {
      code: "SESSION_NOT_COLLECTING",
    });
  }

  const store = Array.isArray(session.stores) ? session.stores[0] : session.stores;

  if (!store) {
    return errorResponse("Store not found for session", 404, {
      code: "STORE_NOT_FOUND",
    });
  }

  const expectedPrefix = `stores/${session.store_id}/`;

  if (!body.filePath!.trim().startsWith(expectedPrefix)) {
    return errorResponse("File does not belong to the session store", 400, {
      code: "FILE_STORE_MISMATCH",
      details: {
        expectedPrefix,
      },
    });
  }

  const workflow = normalizeAdSessionWorkflow(session.workflow);
  const category = getDefaultSessionCategory(store.category);
  const currentRequest = getRequestedShot(workflow, category);

  if (!currentRequest) {
    return errorResponse("No remaining photo request for this session", 400, {
      code: "SESSION_ALREADY_COMPLETE",
    });
  }

  let review;

  try {
    review = await reviewPhotoAsset({
      supabase,
      bucket: body.bucket!.trim(),
      filePath: body.filePath!.trim(),
      assetType: currentRequest.assetType,
      category,
      shotOrder: currentRequest.reviewShotOrder,
    });
  } catch (reviewError) {
    return errorResponse("Failed to review photo", 500, {
      code: "PHOTO_REVIEW_FAILED",
      details:
        reviewError instanceof Error ? reviewError.message : "Unknown error",
    });
  }

  if (!review.passed) {
    return successResponse(
      {
        sessionId: session.id,
        response: "fail",
        status: session.status,
        request: {
          shotKey: currentRequest.shotKey,
          assetType: currentRequest.assetType,
          prompt: currentRequest.prompt,
          helperText: currentRequest.helperText,
        },
        review,
        retryMessage:
          review.feedback[0] ??
          "사진이 기준에 맞지 않습니다. 다시 찍어주세요.",
      },
      "Photo needs retake",
    );
  }

  const currentSortOrder = Array.isArray(session.ad_creation_session_assets)
    ? session.ad_creation_session_assets.length
    : 0;

  const { error: assetInsertError } = await supabase
    .from("ad_creation_session_assets")
    .insert({
      session_id: session.id,
      shot_key: currentRequest.shotKey,
      asset_type: currentRequest.assetType,
      storage_bucket: body.bucket!.trim(),
      file_path: body.filePath!.trim(),
      file_name: body.fileName?.trim() || null,
      mime_type: body.mimeType?.trim() || null,
      file_size: body.fileSize ?? null,
      sort_order: currentSortOrder,
      review_passed: true,
      review_score: review.score,
      review_summary: review.summary,
      review_feedback: review.feedback,
      review_payload: review,
    });

  if (assetInsertError) {
    return errorResponse("Failed to store session photo", 500, {
      code: "SESSION_ASSET_CREATE_FAILED",
      details: assetInsertError.message,
    });
  }

  const nextShot = getNextShot(workflow, category);

  if (nextShot) {
    const updatedWorkflow = {
      ...workflow,
      currentShotIndex: nextShot.nextIndex,
      requestedShotKey: nextShot.request.shotKey,
      lastFailureReason: null,
    };

    const { error: sessionUpdateError } = await supabase
      .from("ad_creation_sessions")
      .update({
        workflow: updatedWorkflow,
      })
      .eq("id", session.id);

    if (sessionUpdateError) {
      return errorResponse("Failed to advance session", 500, {
        code: "SESSION_UPDATE_FAILED",
        details: sessionUpdateError.message,
      });
    }

    after(async () => {
      try {
        await prepareAdSessionDrafts(session.id);
      } catch (draftError) {
        console.error("Ad session draft preparation failed", {
          sessionId: session.id,
          error: draftError,
        });
      }
    });

    return successResponse(
      {
        sessionId: session.id,
        response: "success",
        status: "collecting",
        store: buildSessionSummary(store, updatedWorkflow),
        review,
        request: {
          shotKey: nextShot.request.shotKey,
          assetType: nextShot.request.assetType,
          prompt: nextShot.request.prompt,
          helperText: nextShot.request.helperText,
        },
      },
      "Photo accepted",
    );
  }

  const { data: sessionAssets, error: sessionAssetsError } = await supabase
    .from("ad_creation_session_assets")
    .select(`
      shot_key,
      asset_type,
      storage_bucket,
      file_path,
      file_name,
      mime_type,
      file_size,
      sort_order
    `)
    .eq("session_id", session.id)
    .order("sort_order", { ascending: true });

  if (sessionAssetsError || !sessionAssets) {
    return errorResponse("Failed to load session assets", 500, {
      code: "SESSION_ASSET_LOAD_FAILED",
      details: sessionAssetsError?.message,
    });
  }

  const readyWorkflow = {
    ...workflow,
    currentShotIndex:
      (typeof workflow.currentShotIndex === "number" ? workflow.currentShotIndex : 0) + 1,
    requestedShotKey: null,
    lastFailureReason: null,
  };

  const sessionUpdate = await supabase
    .from("ad_creation_sessions")
    .update({
      status: "generating",
      workflow: readyWorkflow,
    })
    .eq("id", session.id);

  if (sessionUpdate.error) {
    return errorResponse("Failed to mark session ready", 500, {
      code: "SESSION_UPDATE_FAILED",
      details: sessionUpdate.error.message,
    });
  }

  let generation;

  try {
    generation = await createSubmissionAndGenerationJobFromSession({
      supabase,
      session: {
        id: session.id,
        store_id: session.store_id,
        intro_text: session.intro_text,
        ad_type: session.ad_type,
        style_preset: session.style_preset,
      },
      store,
      workflow: readyWorkflow,
      assets: sessionAssets,
    });
  } catch (generationError) {
    await supabase
      .from("ad_creation_sessions")
      .update({
        status: "failed",
        workflow: {
          ...readyWorkflow,
          lastFailureReason:
            generationError instanceof Error
              ? generationError.message
              : "Unknown generation error",
        },
      })
      .eq("id", session.id);

    return errorResponse("Failed to start generation", 500, {
      code: "GENERATION_BOOTSTRAP_FAILED",
      details:
        generationError instanceof Error ? generationError.message : "Unknown error",
    });
  }

  await supabase
    .from("ad_creation_sessions")
    .update({
      submission_id: generation.submissionId,
      generation_job_id: generation.jobId,
      workflow: {
        ...readyWorkflow,
        lastFailureReason: null,
      },
    })
    .eq("id", session.id);

  after(async () => {
    try {
      await processGenerationJobById(generation.jobId);
      await supabase
        .from("ad_creation_sessions")
        .update({
          status: "completed",
        })
        .eq("id", session.id);
    } catch (backgroundError) {
      await supabase
        .from("ad_creation_sessions")
        .update({
          status: "failed",
          workflow: {
            ...readyWorkflow,
            lastFailureReason:
              backgroundError instanceof Error
                ? backgroundError.message
                : "Unknown generation error",
          },
        })
        .eq("id", session.id);
    }
  });

  return successResponse(
    {
      sessionId: session.id,
      response: "success",
      status: "generating",
      state: "끝",
      store: buildSessionSummary(store, readyWorkflow),
      review,
      submissionId: generation.submissionId,
      generationJobId: generation.jobId,
    },
    "Photo accepted and generation started",
  );
}
