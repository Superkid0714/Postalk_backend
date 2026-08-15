import { getSupabaseAdminClient } from "@/lib/supabase/admin";

import {
  getSubmissionTitle,
  pickThumbnailAsset,
  type SubmissionAssetRecord,
  type SubmissionHomeRecord,
} from "@/lib/submissions/home";

export const ARCHIVE_MEDIA_TYPES = ["photo", "video"] as const;
export const ARCHIVE_STATUSES = [
  "all",
  "pending_review",
  "rejected",
  "approved",
] as const;

export type ArchiveMediaType = (typeof ARCHIVE_MEDIA_TYPES)[number];
export type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];

export type ArchiveStoreRecord = {
  id: string;
  market_name: string;
  store_name: string;
};

export type ArchiveSubmissionAssetRow = SubmissionAssetRecord & {
  submission_id: string;
};

export type ArchiveSubmissionRecord = SubmissionHomeRecord & {
  stores: ArchiveStoreRecord | ArchiveStoreRecord[] | null;
};

export function isArchiveMediaType(value: string): value is ArchiveMediaType {
  return ARCHIVE_MEDIA_TYPES.includes(value as ArchiveMediaType);
}

export function isArchiveStatus(value: string): value is ArchiveStatus {
  return ARCHIVE_STATUSES.includes(value as ArchiveStatus);
}

export function normalizeArchiveStore(
  store: ArchiveStoreRecord | ArchiveStoreRecord[] | null,
) {
  if (Array.isArray(store)) {
    return store[0] ?? null;
  }

  return store;
}

export function attachArchiveSubmissionAssets<
  T extends {
    id: string;
  },
>(
  submissions: T[] | null,
  assets: ArchiveSubmissionAssetRow[] | null,
) {
  if (!submissions || submissions.length === 0) {
    return [];
  }

  const assetsBySubmissionId = new Map<string, SubmissionAssetRecord[]>();

  for (const asset of assets ?? []) {
    const currentAssets = assetsBySubmissionId.get(asset.submission_id) ?? [];
    currentAssets.push({
      asset_type: asset.asset_type,
      storage_bucket: asset.storage_bucket,
      file_path: asset.file_path,
      sort_order: asset.sort_order,
    });
    assetsBySubmissionId.set(asset.submission_id, currentAssets);
  }

  return submissions.map((submission) => ({
    ...submission,
    submission_assets: assetsBySubmissionId.get(submission.id) ?? [],
  }));
}

export function getArchiveStatusLabel(status: ArchiveStatus | "approved") {
  switch (status) {
    case "pending_review":
      return "승인 대기중";
    case "rejected":
      return "보충 필요";
    case "approved":
      return "게시 완료";
    case "all":
      return "전체";
    default:
      return status;
  }
}

export async function getArchiveThumbnailUrl(
  asset: SubmissionAssetRecord | null,
) {
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

export async function buildArchiveItem(submission: ArchiveSubmissionRecord) {
  const store = normalizeArchiveStore(submission.stores);
  const thumbnailUrl = await getArchiveThumbnailUrl(
    pickThumbnailAsset(submission.submission_assets),
  );

  return {
    submissionId: submission.id,
    thumbnailUrl,
    title: getSubmissionTitle(submission, store?.store_name ?? "광고"),
    storeName: store?.store_name ?? null,
    marketName: store?.market_name ?? null,
    status: submission.status,
    statusLabel: getArchiveStatusLabel(submission.status),
    createdAt: submission.created_at,
    updatedAt: submission.updated_at,
    mediaType: "photo" as const,
  };
}
