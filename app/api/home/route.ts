import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  getSubmissionStatusLabel,
  getSubmissionStatusMessage,
  getSubmissionTitle,
  pickThumbnailAsset,
  type SubmissionAssetRecord,
  type SubmissionHomeRecord,
} from "@/lib/submissions/home";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

type StoreRecord = {
  id: string;
  owner_name: string | null;
  store_name: string;
};

type AttentionSubmissionRecord = SubmissionHomeRecord;
type MyAdSubmissionRecord = SubmissionHomeRecord;

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
  const storeId = request.nextUrl.searchParams.get("storeId");

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

  const supabase = getSupabaseAdminClient();

  const [
    { data: store, error: storeError },
    { count: pendingReviewCount, error: pendingCountError },
    { count: needsFixCount, error: needsFixCountError },
    { data: attentionSubmissions, error: attentionError },
    { data: myAds, error: myAdsError },
  ] = await Promise.all([
    supabase
      .from("stores")
      .select("id, owner_name, store_name")
      .eq("id", storeId)
      .single<StoreRecord>(),
    supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .eq("status", "pending_review"),
    supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .eq("status", "rejected"),
    supabase
      .from("submissions")
      .select(
        `
          id,
          title,
          target_menu_name,
          status,
          created_at,
          updated_at,
          submission_assets (
            asset_type,
            storage_bucket,
            file_path,
            sort_order
          )
        `,
      )
      .eq("store_id", storeId)
      .in("status", ["pending_review", "rejected"])
      .order("updated_at", { ascending: false })
      .limit(5)
      .returns<AttentionSubmissionRecord[]>(),
    supabase
      .from("submissions")
      .select(
        `
          id,
          title,
          target_menu_name,
          status,
          created_at,
          updated_at,
          submission_assets (
            asset_type,
            storage_bucket,
            file_path,
            sort_order
          )
        `,
      )
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(10)
      .returns<MyAdSubmissionRecord[]>(),
  ]);

  if (storeError || !store) {
    return errorResponse("Store not found", 404, {
      code: "STORE_NOT_FOUND",
    });
  }

  if (
    pendingCountError ||
    needsFixCountError ||
    attentionError ||
    myAdsError
  ) {
    return errorResponse("Failed to load home data", 500, {
      code: "HOME_DATA_LOAD_FAILED",
      details: [
        pendingCountError?.message,
        needsFixCountError?.message,
        attentionError?.message,
        myAdsError?.message,
      ].filter(Boolean),
    });
  }

  const attentionItems = await Promise.all(
    (attentionSubmissions ?? []).map(async (submission) => {
      const thumbnailUrl = await getSignedThumbnailUrl(
        pickThumbnailAsset(submission.submission_assets),
      );

      return {
        submissionId: submission.id,
        thumbnailUrl,
        title: getSubmissionTitle(submission, store.store_name),
        status: submission.status,
        statusLabel: getSubmissionStatusLabel(submission.status),
        message: getSubmissionStatusMessage(submission.status),
        updatedAt: submission.updated_at,
      };
    }),
  );

  const myAdItems = await Promise.all(
    (myAds ?? []).map(async (submission) => {
      const thumbnailUrl = await getSignedThumbnailUrl(
        pickThumbnailAsset(submission.submission_assets),
      );

      return {
        submissionId: submission.id,
        thumbnailUrl,
        title: getSubmissionTitle(submission, store.store_name),
        createdAt: submission.created_at,
        status: submission.status,
        statusLabel: getSubmissionStatusLabel(submission.status),
      };
    }),
  );

  const normalizedPendingReviewCount = pendingReviewCount ?? 0;
  const normalizedNeedsFixCount = needsFixCount ?? 0;

  return successResponse(
    {
      summary: {
        ownerName: store.owner_name ?? "사장님",
        storeName: store.store_name,
        pendingReviewCount: normalizedPendingReviewCount,
        needsFixCount: normalizedNeedsFixCount,
        totalAttentionCount:
          normalizedPendingReviewCount + normalizedNeedsFixCount,
      },
      attentionItems,
      myAds: myAdItems,
    },
    "Home data loaded",
  );
}
