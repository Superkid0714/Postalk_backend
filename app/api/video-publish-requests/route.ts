import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  getSubmissionVideoWorkflowMetadata,
  mergeSubmissionVideoWorkflowMetadata,
} from "@/lib/video-creation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

type PublishVideoRequestBody = {
  submissionId?: string;
};

export async function POST(request: NextRequest) {
  let body: PublishVideoRequestBody;

  try {
    body = (await request.json()) as PublishVideoRequestBody;
  } catch {
    return errorResponse("Invalid JSON body", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  if (!body.submissionId || !isUuid(body.submissionId)) {
    return errorResponse("submissionId must be a valid UUID", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "submissionId", reason: "Invalid UUID" }],
    });
  }

  const supabase = getSupabaseAdminClient();
  const { data: submission, error: submissionError } = await supabase
    .from("submissions")
    .select(`
      id,
      status,
      ai_metadata,
      generation_jobs (
        id,
        status,
        model_name,
        result_asset_id,
        created_at
      )
    `)
    .eq("id", body.submissionId)
    .single();

  if (submissionError || !submission) {
    return errorResponse("Submission not found", 404, {
      code: "SUBMISSION_NOT_FOUND",
    });
  }

  const jobs = Array.isArray(submission.generation_jobs)
    ? submission.generation_jobs
    : [];
  const latestCompletedJob = jobs
    .filter(
      (job) =>
        job.status === "completed" &&
        job.result_asset_id &&
        typeof job.model_name === "string" &&
        job.model_name.startsWith("veo"),
    )
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];

  const workflow = getSubmissionVideoWorkflowMetadata(submission.ai_metadata);

  if (!latestCompletedJob && !workflow.lastCompletedJobId) {
    return errorResponse("No completed generated video is available", 400, {
      code: "GENERATED_VIDEO_NOT_READY",
    });
  }

  const requestedPublishAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("submissions")
    .update({
      status: "pending_review",
      ai_metadata: mergeSubmissionVideoWorkflowMetadata(submission.ai_metadata, {
        currentJobId: latestCompletedJob?.id ?? workflow.currentJobId ?? null,
        lastCompletedJobId:
          latestCompletedJob?.id ?? workflow.lastCompletedJobId ?? null,
        status: "requested_publish",
        requestedPublishAt,
      }),
    })
    .eq("id", submission.id)
    .select("id, status, updated_at")
    .single();

  if (error || !data) {
    return errorResponse("Failed to request video publish", 500, {
      code: "VIDEO_PUBLISH_REQUEST_FAILED",
      details: error?.message,
    });
  }

  return successResponse(
    {
      submissionId: data.id,
      status: data.status,
      videoWorkflowStatus: "requested_publish",
      jobId: latestCompletedJob?.id ?? workflow.lastCompletedJobId ?? null,
      requestedPublishAt,
      updatedAt: data.updated_at,
    },
    "Video publish request submitted",
  );
}
