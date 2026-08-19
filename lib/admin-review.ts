import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getSubmissionStatusLabel,
  getSubmissionStatusMessage,
  getSubmissionTitle,
  pickThumbnailAsset,
  type SubmissionAssetRecord,
  type SubmissionHomeRecord,
} from "@/lib/submissions/home";

export type ReviewStoreRecord = {
  id: string;
  market_name: string;
  store_name: string;
  owner_name?: string | null;
};

export type ReviewAssetRecord = SubmissionAssetRecord & {
  file_name?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
};

export type ReviewSubmissionRecord = Omit<
  SubmissionHomeRecord,
  "submission_assets"
> & {
  submitter_name?: string | null;
  submitter_affiliation?: string | null;
  store_type?: string | null;
  price_text?: string | null;
  appeal_point?: string | null;
  extra_message?: string | null;
  caption?: string | null;
  hashtags?: string[] | null;
  ai_metadata?: Record<string, unknown> | null;
  admin_notes?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  stores: ReviewStoreRecord | ReviewStoreRecord[] | null;
  submission_assets?: ReviewAssetRecord[] | null;
};

function readMerchantInsights(aiMetadata: Record<string, unknown> | null | undefined) {
  if (!aiMetadata || typeof aiMetadata !== "object" || Array.isArray(aiMetadata)) {
    return {
      targetCustomer: null,
      peakSalesTime: null,
      popularMenuNotes: null,
    };
  }

  const merchantInsights = aiMetadata.merchantInsights;

  if (
    !merchantInsights ||
    typeof merchantInsights !== "object" ||
    Array.isArray(merchantInsights)
  ) {
    return {
      targetCustomer: null,
      peakSalesTime: null,
      popularMenuNotes: null,
    };
  }

  const merchantInsightsRecord = merchantInsights as Record<string, unknown>;

  return {
    targetCustomer:
      typeof merchantInsightsRecord.targetCustomer === "string"
        ? merchantInsightsRecord.targetCustomer
        : null,
    peakSalesTime:
      typeof merchantInsightsRecord.peakSalesTime === "string"
        ? merchantInsightsRecord.peakSalesTime
        : null,
    popularMenuNotes:
      typeof merchantInsightsRecord.popularMenuNotes === "string"
        ? merchantInsightsRecord.popularMenuNotes
        : null,
  };
}

function readInstagramPublish(aiMetadata: Record<string, unknown> | null | undefined) {
  if (!aiMetadata || typeof aiMetadata !== "object" || Array.isArray(aiMetadata)) {
    return {
      mediaType: null,
      status: null,
      containerId: null,
      publishedMediaId: null,
      permalink: null,
      caption: null,
      requestedAt: null,
      publishedAt: null,
      lastCheckedAt: null,
      lastError: null,
    };
  }

  const instagramPublish = aiMetadata.instagramPublish;

  if (
    !instagramPublish ||
    typeof instagramPublish !== "object" ||
    Array.isArray(instagramPublish)
  ) {
    return {
      mediaType: null,
      status: null,
      containerId: null,
      publishedMediaId: null,
      permalink: null,
      caption: null,
      requestedAt: null,
      publishedAt: null,
      lastCheckedAt: null,
      lastError: null,
    };
  }

  const instagramPublishRecord = instagramPublish as Record<string, unknown>;

  const readString = (key: string) =>
    typeof instagramPublishRecord[key] === "string"
      ? (instagramPublishRecord[key] as string)
      : null;

  const publishedMediaId = readString("publishedMediaId");
  const publishedAt = readString("publishedAt");
  const rawStatus = readString("status");
  const normalizedStatus =
    publishedMediaId || publishedAt ? "published" : rawStatus;

  return {
    mediaType: readString("mediaType"),
    status: normalizedStatus,
    containerId: readString("containerId"),
    publishedMediaId,
    permalink: readString("permalink"),
    caption: readString("caption"),
    requestedAt: readString("requestedAt"),
    publishedAt,
    lastCheckedAt: readString("lastCheckedAt"),
    lastError: readString("lastError"),
  };
}

function readInstagramMetrics(aiMetadata: Record<string, unknown> | null | undefined) {
  if (!aiMetadata || typeof aiMetadata !== "object" || Array.isArray(aiMetadata)) {
    return {
      mediaId: null,
      permalink: null,
      mediaType: null,
      mediaProductType: null,
      likeCount: null,
      commentsCount: null,
      views: null,
      reach: null,
      impressions: null,
      fetchedAt: null,
      lastError: null,
    };
  }

  const instagramMetrics = aiMetadata.instagramMetrics;

  if (
    !instagramMetrics ||
    typeof instagramMetrics !== "object" ||
    Array.isArray(instagramMetrics)
  ) {
    return {
      mediaId: null,
      permalink: null,
      mediaType: null,
      mediaProductType: null,
      likeCount: null,
      commentsCount: null,
      views: null,
      reach: null,
      impressions: null,
      fetchedAt: null,
      lastError: null,
    };
  }

  const instagramMetricsRecord = instagramMetrics as Record<string, unknown>;

  const readString = (key: string) =>
    typeof instagramMetricsRecord[key] === "string"
      ? (instagramMetricsRecord[key] as string)
      : null;

  const readNumber = (key: string) =>
    typeof instagramMetricsRecord[key] === "number"
      ? (instagramMetricsRecord[key] as number)
      : null;

  return {
    mediaId: readString("mediaId"),
    permalink: readString("permalink"),
    mediaType: readString("mediaType"),
    mediaProductType: readString("mediaProductType"),
    likeCount: readNumber("likeCount"),
    commentsCount: readNumber("commentsCount"),
    views: readNumber("views"),
    reach: readNumber("reach"),
    impressions: readNumber("impressions"),
    fetchedAt: readString("fetchedAt"),
    lastError: readString("lastError"),
  };
}

export function normalizeReviewStore(
  store: ReviewStoreRecord | ReviewStoreRecord[] | null,
) {
  if (Array.isArray(store)) {
    return store[0] ?? null;
  }

  return store;
}

export async function getReviewSignedUrl(asset: SubmissionAssetRecord | null) {
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

export async function buildReviewListItem(submission: ReviewSubmissionRecord) {
  const store = normalizeReviewStore(submission.stores);
  const thumbnailUrl = await getReviewSignedUrl(
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
    createdAt: submission.created_at,
    updatedAt: submission.updated_at,
  };
}

export async function buildReviewDetail(submission: ReviewSubmissionRecord) {
  const store = normalizeReviewStore(submission.stores);
  const merchantInsights = readMerchantInsights(submission.ai_metadata);
  const instagramPublish = readInstagramPublish(submission.ai_metadata);
  const instagramMetrics = readInstagramMetrics(submission.ai_metadata);

  const assets = await Promise.all(
    (submission.submission_assets ?? []).map(async (asset) => ({
      assetType: asset.asset_type,
      fileName: asset.file_name ?? null,
      filePath: asset.file_path,
      mimeType: asset.mime_type ?? null,
      fileSize: asset.file_size ?? null,
      sortOrder: asset.sort_order,
      url: await getReviewSignedUrl(asset),
    })),
  );

  const primaryAsset =
    pickThumbnailAsset(submission.submission_assets) ??
    submission.submission_assets?.[0] ??
    null;

  return {
    submissionId: submission.id,
    title: getSubmissionTitle(submission, store?.store_name ?? "광고"),
    createdAt: submission.created_at,
    updatedAt: submission.updated_at,
    status: submission.status,
    statusLabel: getSubmissionStatusLabel(submission.status),
    store: {
      id: store?.id ?? null,
      marketName: store?.market_name ?? null,
      storeName: store?.store_name ?? null,
      ownerName: store?.owner_name ?? null,
    },
    submitter: {
      name: submission.submitter_name ?? null,
      affiliation: submission.submitter_affiliation ?? null,
    },
    content: {
      storeType: submission.store_type ?? null,
      targetMenuName: submission.target_menu_name ?? null,
      priceText: submission.price_text ?? null,
      appealPoint: submission.appeal_point ?? null,
      targetCustomer: merchantInsights.targetCustomer,
      peakSalesTime: merchantInsights.peakSalesTime,
      popularMenuNotes: merchantInsights.popularMenuNotes,
      extraMessage: submission.extra_message ?? null,
      caption: submission.caption ?? null,
      hashtags: submission.hashtags ?? [],
    },
    review: {
      adminNotes: submission.admin_notes ?? null,
      reviewedBy: submission.reviewed_by ?? null,
      reviewedAt: submission.reviewed_at ?? null,
    },
    instagramPublish,
    instagramMetrics,
    primaryAssetUrl: primaryAsset ? await getReviewSignedUrl(primaryAsset) : null,
    assets,
  };
}
