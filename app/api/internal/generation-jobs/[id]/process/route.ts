import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { requireInternalWorkerKey } from "@/lib/auth/internal-worker";
import { processAnyGenerationJob } from "@/lib/generation/process-any-job";
import { isUuid } from "@/lib/validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const authError = requireInternalWorkerKey(request);
  if (authError) return authError;

  const { id } = await context.params;

  if (!isUuid(id)) {
    return errorResponse("Invalid generation job id", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  try {
    const result = await processAnyGenerationJob(id);

    return successResponse(result, "Generation job processed");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown generation error";

    if (message === "Generation job not found") {
      return errorResponse("Generation job not found", 404, {
        code: "GENERATION_JOB_NOT_FOUND",
      });
    }

    return errorResponse("Generation job failed", 500, {
      code: "GENERATION_JOB_PROCESS_FAILED",
      details: message,
    });
  }
}
