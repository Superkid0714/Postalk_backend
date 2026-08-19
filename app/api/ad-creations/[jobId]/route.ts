import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { getSubmissionWorkflowMetadata } from "@/lib/ad-creation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;

  if (!isUuid(jobId)) {
    return errorResponse("Invalid generation job id", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const supabase = getSupabaseAdminClient();

  const { data: job, error } = await supabase
    .from("generation_jobs")
    .select(`
      id,
      submission_id,
      store_id,
      status,
      style_preset,
      model_name,
      image_size,
      quality,
      failure_reason,
      result_payload,
      result_asset_id,
      result_storage_bucket,
      result_file_path,
      started_at,
      completed_at,
      created_at,
      submissions (
        id,
        status,
        ai_metadata
      )
    `)
    .eq("id", jobId)
    .single();

  if (error || !job) {
    return errorResponse("Ad creation job not found", 404, {
      code: "GENERATION_JOB_NOT_FOUND",
    });
  }

  const submission = Array.isArray(job.submissions)
    ? job.submissions[0]
    : job.submissions;

  const workflow = getSubmissionWorkflowMetadata(submission?.ai_metadata ?? null);

  let resultUrl: string | null = null;
  let generatedAssets: Array<{
    assetId: string | null;
    filePath: string | null;
    promptKey: string | null;
    url: string | null;
  }> = [];
  let imageCount = 1;

  if (job.result_storage_bucket && job.result_file_path) {
    const { data: signedUrlData } = await supabase.storage
      .from(job.result_storage_bucket)
      .createSignedUrl(job.result_file_path, 60 * 60);

    resultUrl = signedUrlData?.signedUrl ?? null;
  }

  if (job.result_payload && typeof job.result_payload === "object") {
    const resultPayload = job.result_payload as {
      imageCount?: unknown;
      generatedImages?: Array<{
        assetId?: unknown;
        filePath?: unknown;
        promptKey?: unknown;
      }>;
    };

    imageCount =
      typeof resultPayload.imageCount === "number" ? resultPayload.imageCount : 1;

    if (Array.isArray(resultPayload.generatedImages)) {
      generatedAssets = await Promise.all(
        resultPayload.generatedImages.map(async (item) => {
          const filePath = typeof item.filePath === "string" ? item.filePath : null;
          const assetId = typeof item.assetId === "string" ? item.assetId : null;
          const promptKey = typeof item.promptKey === "string" ? item.promptKey : null;

          if (!filePath || !job.result_storage_bucket) {
            return {
              assetId,
              filePath,
              promptKey,
              url: null,
            };
          }

          const { data: signedUrlData } = await supabase.storage
            .from(job.result_storage_bucket)
            .createSignedUrl(filePath, 60 * 60);

          return {
            assetId,
            filePath,
            promptKey,
            url: signedUrlData?.signedUrl ?? null,
          };
        }),
      );
    }
  }

  return successResponse(
    {
      jobId: job.id,
      submissionId: job.submission_id,
      storeId: job.store_id,
      status: job.status,
      stylePreset: job.style_preset,
      modelName: job.model_name,
      imageSize: job.image_size,
      quality: job.quality,
      failureReason: job.failure_reason,
      resultAssetId: job.result_asset_id,
      resultStorageBucket: job.result_storage_bucket,
      resultFilePath: job.result_file_path,
      resultUrl,
      imageCount,
      generatedAssets,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      createdAt: job.created_at,
      workflow: {
        adType: workflow.adType ?? "photo",
        publishRequestStatus: workflow.publishRequestStatus ?? "draft",
        currentJobId: workflow.currentJobId ?? null,
        lastCompletedJobId: workflow.lastCompletedJobId ?? null,
        generationRequestedAt: workflow.generationRequestedAt ?? null,
        generatedAt: workflow.generatedAt ?? null,
        requestedPublishAt: workflow.requestedPublishAt ?? null,
        regenerateCount: workflow.regenerateCount ?? 0,
        lastFailureReason: workflow.lastFailureReason ?? null,
      },
      submissionStatus: submission?.status ?? null,
    },
    "Ad creation loaded",
  );
}
