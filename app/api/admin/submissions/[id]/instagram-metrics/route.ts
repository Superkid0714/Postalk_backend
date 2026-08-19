import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { requireAdminApiKey } from "@/lib/auth/admin";
import {
  getStoredInstagramMetricsForSubmission,
  refreshInstagramMetricsForSubmission,
} from "@/lib/instagram/metrics";
import { isInstagramConfigured } from "@/lib/instagram/publish";
import { isUuid } from "@/lib/validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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

  try {
    const refresh =
      request.nextUrl.searchParams.get("refresh") === "true" ||
      request.nextUrl.searchParams.get("refresh") === "1";

    const data = refresh
      ? await refreshInstagramMetricsForSubmission(id)
      : await getStoredInstagramMetricsForSubmission(id);

    return successResponse(
      data,
      refresh
        ? "Instagram metrics refreshed"
        : "Instagram metrics loaded",
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Instagram metrics request failed";

    return errorResponse("Failed to load Instagram metrics", 500, {
      code: "INSTAGRAM_METRICS_FAILED",
      details: message,
    });
  }
}

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

  try {
    void request;
    const data = await refreshInstagramMetricsForSubmission(id);
    return successResponse(data, "Instagram metrics refreshed");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Instagram metrics refresh failed";

    return errorResponse("Failed to refresh Instagram metrics", 500, {
      code: "INSTAGRAM_METRICS_REFRESH_FAILED",
      details: message,
    });
  }
}
