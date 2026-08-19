import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { requireAdminApiKey } from "@/lib/auth/admin";
import {
  isInstagramConfigured,
  startInstagramPublishForSubmission,
  syncInstagramPublishForSubmission,
} from "@/lib/instagram/publish";
import { isUuid } from "@/lib/validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type StartInstagramPublishBody = {
  mediaType?: "photo" | "video";
  captionOverride?: string;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  const { id } = await context.params;

  if (!isUuid(id)) {
    return errorResponse("Invalid submission id", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "id", reason: "id must be a valid UUID" }],
    });
  }

  if (!isInstagramConfigured()) {
    return errorResponse("Instagram publishing is not configured", 400, {
      code: "INSTAGRAM_NOT_CONFIGURED",
    });
  }

  let body: StartInstagramPublishBody = {};

  try {
    body = (await request.json()) as StartInstagramPublishBody;
  } catch {
    body = {};
  }

  if (body.mediaType && body.mediaType !== "photo" && body.mediaType !== "video") {
    return errorResponse("Invalid mediaType", 400, {
      code: "VALIDATION_ERROR",
      details: [
        { field: "mediaType", reason: "mediaType must be photo or video" },
      ],
    });
  }

  try {
    const result = await startInstagramPublishForSubmission(id, body);

    return successResponse(
      result,
      result.status === "published"
        ? "Instagram publish completed"
        : "Instagram publish started",
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Instagram publish failed";

    return errorResponse("Failed to start Instagram publish", 500, {
      code: "INSTAGRAM_PUBLISH_START_FAILED",
      details: message,
    });
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  const { id } = await context.params;

  if (!isUuid(id)) {
    return errorResponse("Invalid submission id", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "id", reason: "id must be a valid UUID" }],
    });
  }

  if (!isInstagramConfigured()) {
    return errorResponse("Instagram publishing is not configured", 400, {
      code: "INSTAGRAM_NOT_CONFIGURED",
    });
  }

  try {
    const result = await syncInstagramPublishForSubmission(id);

    return successResponse(result, "Instagram publish status loaded");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Instagram publish status failed";

    return errorResponse("Failed to load Instagram publish status", 500, {
      code: "INSTAGRAM_PUBLISH_STATUS_FAILED",
      details: message,
    });
  }
}
