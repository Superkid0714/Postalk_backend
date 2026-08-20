import {
  buildVideoPrompt,
  buildVideoScriptWithAi,
  type VideoAspectRatio,
  type VideoDurationSeconds,
  type VideoGenerationScript,
  type VideoResolution,
  type VideoStylePreset,
} from "@/lib/ai/video";

export type VideoWorkflowStatus =
  | "draft"
  | "generating"
  | "generated"
  | "requested_publish"
  | "approved"
  | "rejected";

export type SubmissionVideoWorkflowMetadata = {
  currentJobId?: string | null;
  lastCompletedJobId?: string | null;
  providerOperationName?: string | null;
  status?: VideoWorkflowStatus;
  durationSeconds?: VideoDurationSeconds;
  aspectRatio?: VideoAspectRatio;
  resolution?: VideoResolution;
  stylePreset?: VideoStylePreset;
  generatedAt?: string | null;
  requestedPublishAt?: string | null;
  regenerateCount?: number;
  lastFailureReason?: string | null;
  resultStorageBucket?: string | null;
  resultFilePath?: string | null;
  modelName?: string | null;
  mockMode?: boolean;
  script?: VideoGenerationScript | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getSubmissionVideoWorkflowMetadata(
  aiMetadata: Record<string, unknown> | null | undefined,
): SubmissionVideoWorkflowMetadata {
  if (!isObject(aiMetadata)) {
    return {};
  }

  const workflow = aiMetadata.videoWorkflow;

  if (!isObject(workflow)) {
    return {};
  }

  return workflow as SubmissionVideoWorkflowMetadata;
}

export function mergeSubmissionVideoWorkflowMetadata(
  aiMetadata: Record<string, unknown> | null | undefined,
  updates: Partial<SubmissionVideoWorkflowMetadata>,
) {
  const base = isObject(aiMetadata) ? aiMetadata : {};
  const current = getSubmissionVideoWorkflowMetadata(aiMetadata);

  return {
    ...base,
    videoWorkflow: {
      ...current,
      ...updates,
    },
  };
}

export type VideoSubmissionAsset = {
  asset_type:
    | "menu_board"
    | "food_photo"
    | "generated_image"
    | "generated_video"
    | "video_thumbnail";
  storage_bucket: string;
  file_path: string;
  sort_order: number;
  mime_type?: string | null;
};

export type VideoSubmissionRow = {
  id: string;
  store_id: string;
  store_type: string;
  target_menu_name: string;
  price_text: string;
  appeal_point: string;
  extra_message: string | null;
  ai_metadata: Record<string, unknown> | null;
  stores: {
    market_name: string;
    store_name: string;
    owner_name: string | null;
  } | Array<{
    market_name: string;
    store_name: string;
    owner_name: string | null;
  }> | null;
  submission_assets?: VideoSubmissionAsset[] | null;
};

type MerchantInsights = {
  targetCustomer: string | null;
  peakSalesTime: string | null;
  popularMenuNotes: string | null;
};

function readMerchantInsights(
  aiMetadata: Record<string, unknown> | null | undefined,
): MerchantInsights {
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

  const record = merchantInsights as Record<string, unknown>;

  return {
    targetCustomer:
      typeof record.targetCustomer === "string" ? record.targetCustomer : null,
    peakSalesTime:
      typeof record.peakSalesTime === "string" ? record.peakSalesTime : null,
    popularMenuNotes:
      typeof record.popularMenuNotes === "string" ? record.popularMenuNotes : null,
  };
}

export function normalizeVideoStore(
  stores: VideoSubmissionRow["stores"],
) {
  if (Array.isArray(stores)) {
    return stores[0] ?? null;
  }

  return stores;
}

export function buildSubmissionVideoPrompt(
  submission: VideoSubmissionRow,
  stylePreset: VideoStylePreset,
) {
  const store = normalizeVideoStore(submission.stores);
  const merchantInsights = readMerchantInsights(submission.ai_metadata);

  return buildVideoPrompt(
    {
      storeName: store?.store_name ?? "가게",
      marketName: store?.market_name ?? "전통시장",
      storeType: submission.store_type,
      targetMenuName: submission.target_menu_name,
      priceText: submission.price_text,
      appealPoint: submission.appeal_point,
      extraMessage: submission.extra_message,
      targetCustomer: merchantInsights.targetCustomer,
      peakSalesTime: merchantInsights.peakSalesTime,
      popularMenuNotes: merchantInsights.popularMenuNotes,
    },
    stylePreset,
  );
}

export async function buildSubmissionVideoScript(
  submission: VideoSubmissionRow,
  stylePreset: VideoStylePreset,
) {
  const store = normalizeVideoStore(submission.stores);
  const merchantInsights = readMerchantInsights(submission.ai_metadata);

  return buildVideoScriptWithAi(
    {
      storeName: store?.store_name ?? "가게",
      marketName: store?.market_name ?? "전통시장",
      storeType: submission.store_type,
      targetMenuName: submission.target_menu_name,
      priceText: submission.price_text,
      appealPoint: submission.appeal_point,
      extraMessage: submission.extra_message,
      targetCustomer: merchantInsights.targetCustomer,
      peakSalesTime: merchantInsights.peakSalesTime,
      popularMenuNotes: merchantInsights.popularMenuNotes,
    },
    stylePreset,
  );
}

export function pickPrimaryVideoImage(
  assets: VideoSubmissionAsset[] | null | undefined,
) {
  if (!assets || assets.length === 0) {
    return null;
  }

  const foodPhoto = [...assets]
    .sort((left, right) => left.sort_order - right.sort_order)
    .find((asset) => asset.asset_type === "food_photo");

  if (foodPhoto) {
    return foodPhoto;
  }

  return (
    [...assets]
      .sort((left, right) => left.sort_order - right.sort_order)
      .find((asset) => asset.asset_type === "menu_board") ?? null
  );
}
