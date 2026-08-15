import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  ARCHIVE_STATUSES,
  attachArchiveSubmissionAssets,
  buildArchiveItem,
  isArchiveMediaType,
  isArchiveStatus,
  type ArchiveMediaType,
  type ArchiveSubmissionAssetRow,
  type ArchiveStatus,
  type ArchiveSubmissionRecord,
} from "@/lib/archive";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

function buildArchiveQuery(params: {
  storeId: string;
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
        )
      `,
    )
    .eq("store_id", params.storeId)
    .order("created_at", { ascending: false })
    .limit(params.limit);

  if (params.status !== "all") {
    query = query.eq("status", params.status);
  }

  if (params.mediaType === "video") {
    query = query.eq("id", "__no_video_submissions__");
  }

  return query.returns<ArchiveSubmissionRecord[]>();
}

function buildCountQuery(params: {
  storeId: string;
  status: Exclude<ArchiveStatus, "all">;
  mediaType: ArchiveMediaType;
}) {
  const supabase = getSupabaseAdminClient();

  let query = supabase
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("store_id", params.storeId)
    .eq("status", params.status);

  if (params.mediaType === "video") {
    query = query.eq("id", "__no_video_submissions__");
  }

  return query;
}

export async function GET(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get("storeId");
  const mediaTypeValue = request.nextUrl.searchParams.get("mediaType") ?? "photo";
  const statusValue = request.nextUrl.searchParams.get("status") ?? "all";
  const limitParam = request.nextUrl.searchParams.get("limit");

  if (!storeId) {
    return errorResponse("storeId is required", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "storeId", reason: "storeId is required" }],
    });
  }

  if (!isUuid(storeId)) {
    return errorResponse("Invalid storeId", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "storeId", reason: "storeId must be a valid UUID" }],
    });
  }

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

  const supabase = getSupabaseAdminClient();

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, market_name, store_name, owner_name")
    .eq("id", storeId)
    .single();

  if (storeError || !store) {
    return errorResponse("Store not found", 404, {
      code: "STORE_NOT_FOUND",
    });
  }

  const [
    { count: pendingReviewCount, error: pendingReviewError },
    { count: rejectedCount, error: rejectedError },
    { count: approvedCount, error: approvedError },
    { data: submissions, error: submissionsError },
  ] = await Promise.all([
    buildCountQuery({
      storeId,
      status: "pending_review",
      mediaType: mediaTypeValue,
    }),
    buildCountQuery({
      storeId,
      status: "rejected",
      mediaType: mediaTypeValue,
    }),
    buildCountQuery({
      storeId,
      status: "approved",
      mediaType: mediaTypeValue,
    }),
    buildArchiveQuery({
      storeId,
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
    return errorResponse("Failed to load archive data", 500, {
      code: "ARCHIVE_LOAD_FAILED",
      details: {
        pendingReviewError: pendingReviewError?.message ?? null,
        rejectedError: rejectedError?.message ?? null,
        approvedError: approvedError?.message ?? null,
        submissionsError: submissionsError?.message ?? null,
      },
    });
  }

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
    return errorResponse("Failed to load archive data", 500, {
      code: "ARCHIVE_LOAD_FAILED",
      details: {
        submissionAssetsError: submissionAssetsError.message,
      },
    });
  }

  const submissionsWithAssets = attachArchiveSubmissionAssets(
    submissions ?? [],
    submissionAssets ?? [],
  );
  const items = await Promise.all(submissionsWithAssets.map(buildArchiveItem));

  return successResponse(
    {
      summary: {
        storeId: store.id,
        storeName: store.store_name,
        ownerName: store.owner_name ?? "사장님",
        marketName: store.market_name,
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
    "Archive data loaded",
  );
}
