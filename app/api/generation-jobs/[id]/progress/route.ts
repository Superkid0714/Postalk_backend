import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { requireStoreAccess } from "@/lib/auth/store-access";
import { getGenerationContentType, getGenerationProgress } from "@/lib/generation/progress";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

/** Returns one normalized, poll-friendly progress value for card-news and reels jobs. */
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("Invalid generation job id", 400, { code: "VALIDATION_ERROR" });

  const accessError = await requireStoreAccess(request, { jobId: id });
  if (accessError) return accessError;

  const { data: job, error } = await getSupabaseServiceClient()
    .from("generation_jobs")
    .select("id,submission_id,status,model_name,progress,failure_reason,started_at,completed_at,updated_at")
    .eq("id", id)
    .single();

  if (error || !job) return errorResponse("Generation job not found", 404, { code: "GENERATION_JOB_NOT_FOUND" });

  const normalized = getGenerationProgress(job.status, job.progress);
  return successResponse({
    jobId: job.id,
    submissionId: job.submission_id,
    contentType: getGenerationContentType(job.model_name),
    status: job.status,
    ...normalized,
    failureReason: job.failure_reason,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    updatedAt: job.updated_at,
  }, "Generation progress loaded");
}
