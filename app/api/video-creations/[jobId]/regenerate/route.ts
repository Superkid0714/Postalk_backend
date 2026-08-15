import type { NextRequest } from "next/server";

import { errorResponse } from "@/lib/api/response";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

type RegenerateVideoBody = {
  mockMode?: boolean;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;

  if (!isUuid(jobId)) {
    return errorResponse("Invalid video generation job id", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  let body: RegenerateVideoBody = {};

  try {
    body = (await request.json()) as RegenerateVideoBody;
  } catch {
    body = {};
  }

  const supabase = getSupabaseAdminClient();
  const { data: job, error } = await supabase
    .from("generation_jobs")
    .select("submission_id, style_preset, image_size, quality")
    .eq("id", jobId)
    .single();

  if (error || !job) {
    return errorResponse("Video generation job not found", 404, {
      code: "VIDEO_JOB_NOT_FOUND",
    });
  }

  const forwardedBody = {
    submissionId: job.submission_id,
    stylePreset: job.style_preset ?? "market_story",
    aspectRatio: job.image_size ?? "9:16",
    resolution: job.quality ?? "720p",
    durationSeconds: 8,
    mockMode: body.mockMode === true,
  };

  return fetch(new URL("/api/video-creations/start", request.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(forwardedBody),
  });
}
