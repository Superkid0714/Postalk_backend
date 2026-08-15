import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";
import {
  getSubmissionVideoWorkflowMetadata,
} from "@/lib/video-creation";
import { processVideoJobById } from "@/lib/generation/process-video-job";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;

  if (!isUuid(jobId)) {
    return errorResponse("Invalid video generation job id", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  try {
    await processVideoJobById(jobId);
  } catch {
    // The persisted job state is still returned below.
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
      prompt_text,
      model_name,
      image_size,
      quality,
      failure_reason,
      result_asset_id,
      result_storage_bucket,
      result_file_path,
      request_payload,
      result_payload,
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
    const { data: submissions, error: submissionsError } = await supabase
      .from("submissions")
      .select("id, status, ai_metadata");

    if (submissionsError || !submissions) {
      return errorResponse("Video generation job not found", 404, {
        code: "VIDEO_JOB_NOT_FOUND",
      });
    }

    const matchedSubmission = submissions.find((submission) => {
      const workflow = getSubmissionVideoWorkflowMetadata(
        (submission.ai_metadata as Record<string, unknown> | null) ?? null,
      );

      return (
        workflow.currentJobId === jobId || workflow.lastCompletedJobId === jobId
      );
    });

    if (!matchedSubmission) {
      return errorResponse("Video generation job not found", 404, {
        code: "VIDEO_JOB_NOT_FOUND",
      });
    }

    const workflow = getSubmissionVideoWorkflowMetadata(
      (matchedSubmission.ai_metadata as Record<string, unknown> | null) ?? null,
    );

    let resultUrl: string | null = null;

    if (workflow.resultStorageBucket && workflow.resultFilePath) {
      const { data: signedUrlData } = await supabase.storage
        .from(workflow.resultStorageBucket)
        .createSignedUrl(workflow.resultFilePath, 60 * 60);

      resultUrl = signedUrlData?.signedUrl ?? null;
    }

    return successResponse(
      {
        jobId,
        submissionId: matchedSubmission.id,
        storeId: null,
        status:
          workflow.status === "generated"
            ? "completed"
            : workflow.status ?? "processing",
        stylePreset: workflow.stylePreset ?? "market_story",
        promptText: null,
        modelName: workflow.modelName ?? "veo-mock",
        aspectRatio: workflow.aspectRatio ?? "9:16",
        resolution: workflow.resolution ?? "720p",
        failureReason: workflow.lastFailureReason ?? null,
        resultAssetId: null,
        resultStorageBucket: workflow.resultStorageBucket ?? null,
        resultFilePath: workflow.resultFilePath ?? null,
        resultUrl,
        requestPayload: {
          provider: workflow.mockMode ? "mock" : "unknown",
        },
        resultPayload: {
          script: workflow.script ?? null,
          sample: workflow.mockMode ?? false,
        },
        startedAt: null,
        completedAt: workflow.generatedAt ?? null,
        createdAt: null,
        workflow: {
          status: workflow.status ?? "draft",
          currentJobId: workflow.currentJobId ?? null,
          lastCompletedJobId: workflow.lastCompletedJobId ?? null,
          providerOperationName: workflow.providerOperationName ?? null,
          durationSeconds: workflow.durationSeconds ?? 8,
          aspectRatio: workflow.aspectRatio ?? "9:16",
          resolution: workflow.resolution ?? "720p",
          stylePreset: workflow.stylePreset ?? "market_story",
          generatedAt: workflow.generatedAt ?? null,
          requestedPublishAt: workflow.requestedPublishAt ?? null,
          regenerateCount: workflow.regenerateCount ?? 0,
          lastFailureReason: workflow.lastFailureReason ?? null,
          script: workflow.script ?? null,
        },
        submissionStatus: matchedSubmission.status ?? null,
      },
      "Video generation job loaded",
    );
  }

  const submission = Array.isArray(job.submissions)
    ? job.submissions[0]
    : job.submissions;
  const workflow = getSubmissionVideoWorkflowMetadata(submission?.ai_metadata ?? null);

  let resultUrl: string | null = null;

  if (job.result_storage_bucket && job.result_file_path) {
    const { data: signedUrlData } = await supabase.storage
      .from(job.result_storage_bucket)
      .createSignedUrl(job.result_file_path, 60 * 60);

    resultUrl = signedUrlData?.signedUrl ?? null;
  }

  return successResponse(
    {
      jobId: job.id,
      submissionId: job.submission_id,
      storeId: job.store_id,
      status: job.status,
      stylePreset: job.style_preset,
      promptText: job.prompt_text,
      modelName: job.model_name,
      aspectRatio: job.image_size,
      resolution: job.quality,
      failureReason: job.failure_reason,
      resultAssetId: job.result_asset_id,
      resultStorageBucket: job.result_storage_bucket,
      resultFilePath: job.result_file_path,
      resultUrl,
      requestPayload: job.request_payload,
      resultPayload: job.result_payload,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      createdAt: job.created_at,
      workflow: {
        status: workflow.status ?? "draft",
        currentJobId: workflow.currentJobId ?? null,
        lastCompletedJobId: workflow.lastCompletedJobId ?? null,
        providerOperationName: workflow.providerOperationName ?? null,
        durationSeconds: workflow.durationSeconds ?? 8,
        aspectRatio: workflow.aspectRatio ?? "9:16",
        resolution: workflow.resolution ?? "720p",
        stylePreset: workflow.stylePreset ?? "market_story",
        generatedAt: workflow.generatedAt ?? null,
        requestedPublishAt: workflow.requestedPublishAt ?? null,
        regenerateCount: workflow.regenerateCount ?? 0,
        lastFailureReason: workflow.lastFailureReason ?? null,
        script: workflow.script ?? null,
      },
      submissionStatus: submission?.status ?? null,
    },
    "Video generation job loaded",
  );
}
