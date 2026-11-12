import { requireStoreAccess } from "@/lib/auth/store-access";
import { GUEST_SESSION_HEADER } from "@/lib/auth/guest-session";
import { readRequestBody } from "@/lib/api/request-body";
import { after, NextRequest } from "next/server";
import { POST as startVideoCreation } from "@/app/api/video-creations/start/route";

import { errorResponse, successResponse } from "@/lib/api/response";
import { REELS_PROVIDER } from "@/lib/ai/reels";
import { processVideoJobById } from "@/lib/generation/process-video-job";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/validation";
import { getSubmissionVideoWorkflowMetadata } from "@/lib/video-creation";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

type RegenerateVideoBody = {
  mockMode?: boolean;
};

function forwardedHeaders(request: NextRequest) {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const name of ["x-merchant-qr-token", GUEST_SESSION_HEADER]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;

  if (!isUuid(jobId)) {
    return errorResponse("Invalid video generation job id", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  let body: RegenerateVideoBody = {};

  try {
    body = request.body ? (await readRequestBody(request)) as RegenerateVideoBody : {};
  } catch {
    return errorResponse("Invalid JSON body", 400, { code: "VALIDATION_ERROR" });
  }

  const accessError = await requireStoreAccess(request, { jobId });
  if (accessError) return accessError;

  const supabase = getSupabaseServiceClient();
  const { data: job, error } = await supabase
    .from("generation_jobs")
    .select("submission_id, style_preset, image_size, quality, model_name, status")
    .eq("id", jobId)
    .single();

  if (error || !job) {
    const { data: submissions, error: submissionsError } = await supabase
      .from("submissions")
      .select("id, ai_metadata");

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

    const forwardedBody = {
      submissionId: matchedSubmission.id,
      stylePreset: workflow.stylePreset ?? "market_story",
      aspectRatio: workflow.aspectRatio ?? "9:16",
      resolution: workflow.resolution ?? "720p",
      durationSeconds: workflow.durationSeconds ?? 8,
      mockMode: body.mockMode === true || workflow.mockMode === true,
    };

    return startVideoCreation(new NextRequest(new URL("/api/video-creations/start", request.url), {
      method: "POST",
      headers: forwardedHeaders(request),
      body: JSON.stringify(forwardedBody),
    }));
  }

  if (job.model_name === REELS_PROVIDER) {
    if (job.status !== "failed") return errorResponse("Only failed reel jobs can be retried", 409, { code: "REELS_RETRY_CONFLICT" });
    const { data: requeued, error: retryError } = await supabase.from("generation_jobs")
      .update({ status: "queued", failure_reason: null, started_at: null, completed_at: null })
      .eq("id", jobId).eq("status", "failed").select("id").maybeSingle();
    if (retryError) return errorResponse("Unable to retry reel generation", 503, { code: "REELS_RETRY_FAILED" });
    if (!requeued) return errorResponse("This reel job is already being retried", 409, { code: "REELS_RETRY_CONFLICT" });
    await supabase.from("ad_creation_sessions").update({ status: "generating" }).eq("generation_job_id", jobId);
    after(async () => {
      try {
        const result = await processVideoJobById(jobId);
        if (result.status === "completed") {
          await supabase.from("ad_creation_sessions").update({ status: "completed" }).eq("generation_job_id", jobId);
        }
      } catch (error) {
        console.error("Reel retry failed", { jobId, error });
      }
    });
    return successResponse({ jobId, submissionId: job.submission_id, status: "queued" }, "Reel generation queued", 202);
  }

  const forwardedBody = {
    submissionId: job.submission_id,
    stylePreset: job.style_preset ?? "market_story",
    aspectRatio: job.image_size ?? "9:16",
    resolution: job.quality ?? "720p",
    durationSeconds: 8,
    mockMode: body.mockMode === true,
  };

  return startVideoCreation(new NextRequest(new URL("/api/video-creations/start", request.url), {
    method: "POST",
    headers: forwardedHeaders(request),
    body: JSON.stringify(forwardedBody),
  }));
}
