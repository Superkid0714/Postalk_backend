import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  getSubmissionWorkflowMetadata,
  mergeSubmissionWorkflowMetadata,
} from "@/lib/ad-creation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

type PublishRequestBody = {
  submissionId?: string;
};

export async function POST(request: NextRequest) {
  let body: PublishRequestBody;

  try {
    body = (await request.json()) as PublishRequestBody;
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
    .filter((job) => job.status === "completed" && job.result_asset_id)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];

  if (!latestCompletedJob) {
    return errorResponse("No completed generated ad is available", 400, {
      code: "GENERATED_AD_NOT_READY",
    });
  }

  const workflow = getSubmissionWorkflowMetadata(submission.ai_metadata);

  if (workflow.publishRequestStatus === "requested_publish") {
    return successResponse(
      {
        submissionId: submission.id,
        status: submission.status,
        publishRequestStatus: "requested_publish",
        jobId: workflow.lastCompletedJobId ?? workflow.currentJobId ?? null,
        requestedPublishAt: workflow.requestedPublishAt ?? null,
        reused: true,
      },
      "Publish request already submitted",
    );
  }

  const requestedPublishAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("submissions")
    .update({
      status: "pending_review",
      ai_metadata: mergeSubmissionWorkflowMetadata(submission.ai_metadata, {
        adType: workflow.adType ?? "photo",
        publishRequestStatus: "requested_publish",
        currentJobId: latestCompletedJob.id,
        lastCompletedJobId: latestCompletedJob.id,
        requestedPublishAt,
      }),
    })
    .eq("id", submission.id)
    .select("id, status, updated_at")
    .single();

  if (error || !data) {
    return errorResponse("Failed to request publish", 500, {
      code: "PUBLISH_REQUEST_FAILED",
      details: error?.message,
    });
  }

  return successResponse(
    {
      submissionId: data.id,
      status: data.status,
      publishRequestStatus: "requested_publish",
      jobId: latestCompletedJob.id,
      requestedPublishAt,
      updatedAt: data.updated_at,
    },
    "Publish request submitted",
  );
}
