import { requireStoreAccess } from "@/lib/auth/store-access";
import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  ARCHIVE_STATUSES,
  attachArchiveSubmissionAssets,
  buildArchiveItem,
  isArchiveMediaType,
  isArchiveStatus,
  type ArchiveSubmissionAssetRow,
  type ArchiveStatus,
  type ArchiveSubmissionRecord,
} from "@/lib/archive";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/validation";

function buildArchiveQuery(params: {
  storeId: string;
  limit: number;
  status: ArchiveStatus;
  submissionIds?: string[] | null;
}) {
  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("submissions")
    .select(
      `
        id,
        title,
        target_menu_name,
        appeal_point,
        extra_message,
        caption,
        hashtags,
        ai_metadata,
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

  if (params.submissionIds) {
    query = params.submissionIds.length
      ? query.in("id", params.submissionIds)
      : query.in("id", ["00000000-0000-0000-0000-000000000000"]);
  }

  return query.returns<ArchiveSubmissionRecord[]>();
}

function buildCountQuery(params: {
  storeId: string;
  status: Exclude<ArchiveStatus, "all">;
  submissionIds?: string[] | null;
}) {
  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("store_id", params.storeId)
    .eq("status", params.status);

  if (params.submissionIds) {
    query = params.submissionIds.length
      ? query.in("id", params.submissionIds)
      : query.in("id", ["00000000-0000-0000-0000-000000000000"]);
  }

  return query;
}

async function getMediaSubmissionIds(storeId: string, mediaType: "photo" | "video") {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("submission_assets")
    .select("submission_id, submissions!inner(store_id)")
    .eq("asset_type", mediaType === "photo" ? "generated_image" : "generated_video")
    .eq("submissions.store_id", storeId);

  if (error) {
    return { data: null, error };
  }

  return {
    data: [...new Set((data ?? []).map((item) => item.submission_id))],
    error: null,
  };
}

export async function GET(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get("storeId");
  const rawMediaTypeValue =
    request.nextUrl.searchParams.get("mediaType") ??
    request.nextUrl.searchParams.get("type") ??
    "photo";
  const mediaTypeValue =
    rawMediaTypeValue === "image" ? "photo" : rawMediaTypeValue;
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
      ? Math.min(Math.max(Math.trunc(Number(limitParam)), 1), 50)
      : 20;

  const accessError = await requireStoreAccess(request, { storeId });
  if (accessError) return accessError;

  const supabase = getSupabaseServiceClient();

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

  const mediaIds = await getMediaSubmissionIds(storeId, mediaTypeValue);
  if (mediaIds.error) return errorResponse("Unable to load archive assets", 503, { code: "ARCHIVE_LOAD_FAILED" });
  const mediaSubmissionIds = mediaIds.data ?? [];

  const [
    { count: draftCount, error: draftError },
    { count: publishedCount, error: publishedError },
    { data: submissions, error: submissionsError },
  ] = await Promise.all([
    buildCountQuery({
      storeId,
      status: "draft",
      submissionIds: mediaSubmissionIds,
    }),
    buildCountQuery({ storeId, status: "published", submissionIds: mediaSubmissionIds }),
    buildArchiveQuery({
      storeId,
      status: statusValue,
      submissionIds: mediaSubmissionIds,
      limit,
    }),
  ]);

  if (
    draftError ||
    publishedError ||
    submissionsError
  ) {
    return errorResponse("Failed to load archive data", 500, {
      code: "ARCHIVE_LOAD_FAILED",
      details: {
        draftError: draftError?.message ?? null,
        publishedError: publishedError?.message ?? null,
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
  const items = await Promise.all(
    submissionsWithAssets.map((submission) =>
      buildArchiveItem(submission, mediaTypeValue),
    ),
  );

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
          all: (draftCount ?? 0) + (publishedCount ?? 0),
          draft: draftCount ?? 0,
          published: publishedCount ?? 0,
        },
      },
      items,
    },
    "Archive data loaded",
  );
}
