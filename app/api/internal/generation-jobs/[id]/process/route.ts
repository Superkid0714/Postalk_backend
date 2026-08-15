import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { getAdminApiKey } from "@/lib/env";
import { processGenerationJobById } from "@/lib/generation/process-job";
import { isUuid } from "@/lib/validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function isAuthorized(request: NextRequest) {
  const adminApiKey = getAdminApiKey();

  if (!adminApiKey) {
    return false;
  }

  return request.headers.get("x-admin-key") === adminApiKey;
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isAuthorized(request)) {
    return errorResponse("Unauthorized", 401, {
      code: "UNAUTHORIZED",
    });
  }

  const { id } = await context.params;

  if (!isUuid(id)) {
    return errorResponse("Invalid generation job id", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  try {
    const result = await processGenerationJobById(id);

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
