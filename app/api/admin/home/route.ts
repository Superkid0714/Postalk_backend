import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { requireAdminApiKey } from "@/lib/auth/admin";
import {
  getSubmissionStatusLabel,
  getSubmissionStatusMessage,
  getSubmissionTitle,
  pickThumbnailAsset,
  type SubmissionAssetRecord,
  type SubmissionHomeRecord,
} from "@/lib/submissions/home";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminStoreRecord = {
  id: string;
  market_name: string;
  store_name: string;
};

type AdminSubmissionRecord = SubmissionHomeRecord & {
  stores: AdminStoreRecord | AdminStoreRecord[] | null;
};

function normalizeStoreRecord(
  store: AdminStoreRecord | AdminStoreRecord[] | null,
) {
  if (Array.isArray(store)) {
    return store[0] ?? null;
  }

  return store;
}

async function getSignedThumbnailUrl(asset: SubmissionAssetRecord | null) {
  if (!asset) {
    return null;
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.storage
    .from(asset.storage_bucket)
    .createSignedUrl(asset.file_path, 60 * 60);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

export async function GET(request: NextRequest) {
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  const marketName = request.nextUrl.searchParams.get("marketName")?.trim() || null;
  const pendingLimitParam = request.nextUrl.searchParams.get("pendingLimit");
  const recentLimitParam = request.nextUrl.searchParams.get("recentLimit");

  const pendingLimit =
    typeof pendingLimitParam === "string" &&
    Number.isFinite(Number(pendingLimitParam))
      ? Math.min(Math.max(Number(pendingLimitParam), 1), 20)
      : 5;

  const recentLimit =
    typeof recentLimitParam === "string" &&
    Number.isFinite(Number(recentLimitParam))
      ? Math.min(Math.max(Number(recentLimitParam), 1), 20)
      : 10;

  const supabase = getSupabaseAdminClient();

  const pendingCountQuery = supabase
    .from("submissions")
    .select("id, stores!inner(market_name)", { count: "exact", head: true })
    .eq("status", "pending_review");

  const pendingItemsQuery = supabase
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
    .eq("status", "pending_review")
    .order("updated_at", { ascending: false })
    .limit(pendingLimit);

  const recentItemsQuery = supabase
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
    .limit(recentLimit);

  if (marketName) {
    pendingCountQuery.eq("stores.market_name", marketName);
    pendingItemsQuery.eq("stores.market_name", marketName);
    recentItemsQuery.eq("stores.market_name", marketName);
  }

  const { count: pendingReviewCount, error: pendingCountError } =
    await pendingCountQuery;
  const { data: pendingItemsData, error: pendingItemsError } =
    await pendingItemsQuery.returns<AdminSubmissionRecord[]>();
  const { data: recentItemsData, error: recentItemsError } =
    await recentItemsQuery.returns<AdminSubmissionRecord[]>();

  if (pendingCountError || pendingItemsError || recentItemsError) {
    return errorResponse("Failed to load admin home data", 500, {
      code: "ADMIN_HOME_LOAD_FAILED",
      details: {
        pendingCountError: pendingCountError?.message ?? null,
        pendingItemsError: pendingItemsError?.message ?? null,
        recentItemsError: recentItemsError?.message ?? null,
      },
    });
  }

  const pendingItems = await Promise.all(
    (pendingItemsData ?? []).map(async (submission) => {
      const store = normalizeStoreRecord(submission.stores);
      const thumbnailUrl = await getSignedThumbnailUrl(
        pickThumbnailAsset(submission.submission_assets),
      );

      return {
        submissionId: submission.id,
        thumbnailUrl,
        title: getSubmissionTitle(submission, store?.store_name ?? "광고"),
        storeName: store?.store_name ?? null,
        marketName: store?.market_name ?? null,
        status: submission.status,
        statusLabel: getSubmissionStatusLabel(submission.status),
        message: getSubmissionStatusMessage(submission.status),
        updatedAt: submission.updated_at,
      };
    }),
  );

  const recentItems = await Promise.all(
    (recentItemsData ?? []).map(async (submission) => {
      const store = normalizeStoreRecord(submission.stores);
      const thumbnailUrl = await getSignedThumbnailUrl(
        pickThumbnailAsset(submission.submission_assets),
      );

      return {
        submissionId: submission.id,
        thumbnailUrl,
        title: getSubmissionTitle(submission, store?.store_name ?? "광고"),
        storeName: store?.store_name ?? null,
        marketName: store?.market_name ?? null,
        status: submission.status,
        statusLabel: getSubmissionStatusLabel(submission.status),
        createdAt: submission.created_at,
      };
    }),
  );

  return successResponse(
    {
      summary: {
        marketName: marketName ?? "전체 시장",
        pendingReviewCount: pendingReviewCount ?? 0,
      },
      pendingItems,
      recentItems,
    },
    "Admin home data loaded",
  );
}
