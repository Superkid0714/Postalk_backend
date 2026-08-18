import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { requireAdminApiKey } from "@/lib/auth/admin";
import {
  ARCHIVE_STATUSES,
  VIDEO_ASSET_TYPES,
  attachArchiveSubmissionAssets,
  buildArchiveItem,
  isArchiveMediaType,
  isArchiveStatus,
  type ArchiveSubmissionAssetRow,
  type ArchiveStatus,
  type ArchiveSubmissionRecord,
} from "@/lib/archive";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

function buildAdminArchiveQuery(params: {
  marketName: string | null;
  limit: number;
  status: ArchiveStatus;
  submissionIds?: string[] | null;
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

  if (params.submissionIds) {
    query = params.submissionIds.length
      ? query.in("id", params.submissionIds)
      : query.in("id", ["00000000-0000-0000-0000-000000000000"]);
  }

  return query.returns<ArchiveSubmissionRecord[]>();
}

function buildAdminCountQuery(params: {
  marketName: string | null;
  status: Exclude<ArchiveStatus, "all">;
  submissionIds?: string[] | null;
}) {
  const supabase = getSupabaseAdminClient();

  let query = supabase
    .from("submissions")
    .select("id, stores!inner(market_name)", { count: "exact", head: true })
    .eq("status", params.status);

  if (params.marketName) {
    query = query.eq("stores.market_name", params.marketName);
  }

  if (params.submissionIds) {
    query = params.submissionIds.length
      ? query.in("id", params.submissionIds)
      : query.in("id", ["00000000-0000-0000-0000-000000000000"]);
  }

  return query;
}

async function getAdminVideoSubmissionIds(marketName: string | null) {
  const supabase = getSupabaseAdminClient();

  let query = supabase
    .from("submissions")
    .select("id, submission_assets!inner(asset_type), stores!inner(market_name)")
    .in("submission_assets.asset_type", [...VIDEO_ASSET_TYPES]);

  if (marketName) {
    query = query.eq("stores.market_name", marketName);
  }

  const { data, error } = await query;

  if (error) {
    return { data: null, error };
  }

  return {
    data: [...new Set((data ?? []).map((item) => item.id))],
    error: null,
  };
}

export async function GET(request: NextRequest) {
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  const marketName = request.nextUrl.searchParams.get("marketName")?.trim() || null;
  const rawMediaTypeValue =
    request.nextUrl.searchParams.get("mediaType") ??
    request.nextUrl.searchParams.get("type") ??
    "photo";
  const mediaTypeValue =
    rawMediaTypeValue === "image" ? "photo" : rawMediaTypeValue;
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

  const videoSubmissionIdsResult =
    mediaTypeValue === "video"
      ? await getAdminVideoSubmissionIds(marketName)
      : null;

  if (videoSubmissionIdsResult?.error) {
    return errorResponse("Failed to load admin archive data", 500, {
      code: "ADMIN_ARCHIVE_LOAD_FAILED",
      details: {
        videoSubmissionIdsError: videoSubmissionIdsResult.error.message,
      },
    });
  }

  const mediaSubmissionIds =
    mediaTypeValue === "video" ? (videoSubmissionIdsResult?.data ?? []) : null;

  const [
    { count: pendingReviewCount, error: pendingReviewError },
    { count: rejectedCount, error: rejectedError },
    { count: approvedCount, error: approvedError },
    { data: submissions, error: submissionsError },
  ] = await Promise.all([
    buildAdminCountQuery({
      marketName,
      status: "pending_review",
      submissionIds: mediaSubmissionIds,
    }),
    buildAdminCountQuery({
      marketName,
      status: "rejected",
      submissionIds: mediaSubmissionIds,
    }),
    buildAdminCountQuery({
      marketName,
      status: "approved",
      submissionIds: mediaSubmissionIds,
    }),
    buildAdminArchiveQuery({
      marketName,
      status: statusValue,
      submissionIds: mediaSubmissionIds,
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

  const supabase = getSupabaseAdminClient();
  const submissionIds = (submissions ?? []).map((submission) => submission.id);
  const { data: submissionAssets, error: submissionAssetsError } =
    submissionIds.length === 0
      ? { data: [] as ArchiveSubmissionAssetRow[], error: null }
      : await supabase
          .from("submission_assets")
          .select(
            `
              submission_id,
              asset_type,
              storage_bucket,
              file_path,
              sort_order
            `,
          )
          .in("submission_id", submissionIds)
          .returns<ArchiveSubmissionAssetRow[]>();

  if (submissionAssetsError) {
    return errorResponse("Failed to load admin archive data", 500, {
      code: "ADMIN_ARCHIVE_LOAD_FAILED",
      details: {
        submissionAssetsError: submissionAssetsError.message,
      },
    });
  }

  const submissionsWithAssets = attachArchiveSubmissionAssets(
    submissions ?? [],
    submissionAssets ?? [],
  );
  const items = await Promise.all(
    submissionsWithAssets.map((submission) =>
      buildArchiveItem(submission, mediaTypeValue),
    ),
  );

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
