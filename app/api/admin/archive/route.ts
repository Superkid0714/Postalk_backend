import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { requireAdminApiKey } from "@/lib/auth/admin";
import {
  ARCHIVE_STATUSES,
  buildArchiveItem,
  isArchiveMediaType,
  isArchiveStatus,
  type ArchiveMediaType,
  type ArchiveStatus,
  type ArchiveSubmissionRecord,
} from "@/lib/archive";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

function buildAdminArchiveQuery(params: {
  marketName: string | null;
  limit: number;
  status: ArchiveStatus;
  mediaType: ArchiveMediaType;
}) {
  const supabase = getSupabaseAdminClient();

  let query = supabase
    .from("submissions")
    .select(
      `
        id,
        title,
        target_menu_name,
        status,
        created_at,
        updated_at,
        stores!inner (
          id,
          market_name,
          store_name
        ),
        submission_assets (
          asset_type,
          storage_bucket,
          file_path,
          sort_order
        )
      `,
    )
    .order("created_at", { ascending: false })
    .limit(params.limit);

  if (params.marketName) {
    query = query.eq("stores.market_name", params.marketName);
  }

  if (params.status !== "all") {
    query = query.eq("status", params.status);
  }

  if (params.mediaType === "video") {
    query = query.eq("id", "__no_video_submissions__");
  }

  return query.returns<ArchiveSubmissionRecord[]>();
}

function buildAdminCountQuery(params: {
  marketName: string | null;
  status: Exclude<ArchiveStatus, "all">;
  mediaType: ArchiveMediaType;
}) {
  const supabase = getSupabaseAdminClient();

  let query = supabase
    .from("submissions")
    .select("id, stores!inner(market_name)", { count: "exact", head: true })
    .eq("status", params.status);

  if (params.marketName) {
    query = query.eq("stores.market_name", params.marketName);
  }

  if (params.mediaType === "video") {
    query = query.eq("id", "__no_video_submissions__");
  }

  return query;
}

export async function GET(request: NextRequest) {
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  const marketName = request.nextUrl.searchParams.get("marketName")?.trim() || null;
  const mediaTypeValue = request.nextUrl.searchParams.get("mediaType") ?? "photo";
  const statusValue = request.nextUrl.searchParams.get("status") ?? "all";
  const limitParam = request.nextUrl.searchParams.get("limit");

  if (!isArchiveMediaType(mediaTypeValue)) {
    return errorResponse("Invalid mediaType", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "mediaType", reason: "mediaType must be photo or video" }],
    });
  }

  if (!isArchiveStatus(statusValue)) {
    return errorResponse("Invalid status", 400, {
      code: "VALIDATION_ERROR",
      details: [
        {
          field: "status",
          reason: `status must be one of ${ARCHIVE_STATUSES.join(", ")}`,
        },
      ],
    });
  }

  const limit =
    typeof limitParam === "string" && Number.isFinite(Number(limitParam))
      ? Math.min(Math.max(Number(limitParam), 1), 50)
      : 20;

  const [
    { count: pendingReviewCount, error: pendingReviewError },
    { count: rejectedCount, error: rejectedError },
    { count: approvedCount, error: approvedError },
    { data: submissions, error: submissionsError },
  ] = await Promise.all([
    buildAdminCountQuery({
      marketName,
      status: "pending_review",
      mediaType: mediaTypeValue,
    }),
    buildAdminCountQuery({
      marketName,
      status: "rejected",
      mediaType: mediaTypeValue,
    }),
    buildAdminCountQuery({
      marketName,
      status: "approved",
      mediaType: mediaTypeValue,
    }),
    buildAdminArchiveQuery({
      marketName,
      status: statusValue,
      mediaType: mediaTypeValue,
      limit,
    }),
  ]);

  if (
    pendingReviewError ||
    rejectedError ||
    approvedError ||
    submissionsError
  ) {
    return errorResponse("Failed to load admin archive data", 500, {
      code: "ADMIN_ARCHIVE_LOAD_FAILED",
      details: {
        pendingReviewError: pendingReviewError?.message ?? null,
        rejectedError: rejectedError?.message ?? null,
        approvedError: approvedError?.message ?? null,
        submissionsError: submissionsError?.message ?? null,
      },
    });
  }

  const items = await Promise.all((submissions ?? []).map(buildArchiveItem));

  return successResponse(
    {
      summary: {
        marketName: marketName ?? "전체 시장",
        mediaType: mediaTypeValue,
        selectedStatus: statusValue,
        counts: {
          all:
            (pendingReviewCount ?? 0) +
            (rejectedCount ?? 0) +
            (approvedCount ?? 0),
          pendingReview: pendingReviewCount ?? 0,
          rejected: rejectedCount ?? 0,
          approved: approvedCount ?? 0,
        },
      },
      items,
    },
    "Admin archive data loaded",
  );
}
