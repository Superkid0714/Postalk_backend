import { getSupabaseAdminClient } from "@/lib/supabase/admin";

import {
  getSubmissionTitle,
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
export const VIDEO_ASSET_TYPES = ["generated_video", "video_thumbnail"] as const;

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
  appeal_point?: string | null;
  extra_message?: string | null;
  caption?: string | null;
  hashtags?: string[] | null;
  ai_metadata?: Record<string, unknown> | null;
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

async function buildArchivePreviewAssets(
  assets: SubmissionAssetRecord[] | null | undefined,
  mediaType: ArchiveMediaType,
) {
  if (!assets || assets.length === 0) {
    return [];
  }

  const sortedAssets = [...assets].sort((left, right) => left.sort_order - right.sort_order);
  const targetAssets =
    mediaType === "video"
      ? sortedAssets.filter(
          (asset) =>
            asset.asset_type === "video_thumbnail" ||
            asset.asset_type === "generated_video",
        )
      : sortedAssets.filter((asset) => asset.asset_type === "generated_image");

  return Promise.all(
    targetAssets.map(async (asset, index) => ({
      index,
      assetType: asset.asset_type,
      sortOrder: asset.sort_order,
      url: await getArchiveThumbnailUrl(asset),
    })),
  );
}

function getVideoScriptCaption(aiMetadata: Record<string, unknown> | null | undefined) {
  if (
    !aiMetadata ||
    typeof aiMetadata !== "object" ||
    Array.isArray(aiMetadata) ||
    !("videoWorkflow" in aiMetadata)
  ) {
    return null;
  }

  const videoWorkflow = aiMetadata.videoWorkflow;

  if (
    !videoWorkflow ||
    typeof videoWorkflow !== "object" ||
    Array.isArray(videoWorkflow) ||
    !("script" in videoWorkflow)
  ) {
    return null;
  }

  const script = videoWorkflow.script;

  if (!script || typeof script !== "object" || Array.isArray(script)) {
    return null;
  }

  const scriptRecord = script as Record<string, unknown>;

  return typeof scriptRecord.caption === "string" ? scriptRecord.caption : null;
}

function buildArchiveCaption(submission: ArchiveSubmissionRecord) {
  const baseCaption =
    submission.caption?.trim() ||
    getVideoScriptCaption(submission.ai_metadata)?.trim() ||
    [submission.target_menu_name, submission.appeal_point, submission.extra_message]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .join(" ");

  const hashtags = (submission.hashtags ?? [])
    .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    .join(" ");

  return [baseCaption, hashtags].filter(Boolean).join("\n\n") || null;
}

function getInstagramPermalink(
  aiMetadata: Record<string, unknown> | null | undefined,
) {
  if (!aiMetadata || typeof aiMetadata !== "object" || Array.isArray(aiMetadata)) {
    return null;
  }

  const instagramPublish = aiMetadata.instagramPublish;

  if (
    instagramPublish &&
    typeof instagramPublish === "object" &&
    !Array.isArray(instagramPublish) &&
    typeof (instagramPublish as Record<string, unknown>).permalink === "string"
  ) {
    return (instagramPublish as Record<string, unknown>).permalink as string;
  }

  const instagramMetrics = aiMetadata.instagramMetrics;

  if (
    instagramMetrics &&
    typeof instagramMetrics === "object" &&
    !Array.isArray(instagramMetrics) &&
    typeof (instagramMetrics as Record<string, unknown>).permalink === "string"
  ) {
    return (instagramMetrics as Record<string, unknown>).permalink as string;
  }

  return null;
}

function pickGeneratedAsset(
  assets: SubmissionAssetRecord[] | null | undefined,
  mediaType: ArchiveMediaType,
) {
  if (!assets || assets.length === 0) {
    return null;
  }

  const sortedAssets = [...assets].sort((left, right) => left.sort_order - right.sort_order);

  if (mediaType === "video") {
    return (
      sortedAssets.find((asset) => asset.asset_type === "video_thumbnail") ??
      sortedAssets.find((asset) => asset.asset_type === "generated_video") ??
      null
    );
  }

  return sortedAssets.find((asset) => asset.asset_type === "generated_image") ?? null;
}

export async function buildArchiveItem(
  submission: ArchiveSubmissionRecord,
  mediaType: ArchiveMediaType = "photo",
) {
  const store = normalizeArchiveStore(submission.stores);
  const previewAssets = await buildArchivePreviewAssets(
    submission.submission_assets,
    mediaType,
  );
  const thumbnailUrl = previewAssets[0]?.url ?? null;
  const generatedAsset = pickGeneratedAsset(submission.submission_assets, mediaType);
  const generatedAssetUrl = await getArchiveThumbnailUrl(generatedAsset);
  const publishCaption = buildArchiveCaption(submission);
  const instagramPermalink = getInstagramPermalink(submission.ai_metadata);

  return {
    submissionId: submission.id,
    thumbnailUrl,
    generatedAssetUrl,
    title: getSubmissionTitle(submission, store?.store_name ?? "광고"),
    storeName: store?.store_name ?? null,
    marketName: store?.market_name ?? null,
    status: submission.status,
    statusLabel: getArchiveStatusLabel(submission.status),
    createdAt: submission.created_at,
    updatedAt: submission.updated_at,
    mediaType,
    publishCaption,
    instagramPermalink,
    previewAssets,
  };
}
