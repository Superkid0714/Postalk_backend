import {
  buildVideoPrompt,
  buildVideoScript,
  type VideoAspectRatio,
  type VideoDurationSeconds,
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
  script?: ReturnType<typeof buildVideoScript> | null;
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

  return buildVideoPrompt(
    {
      storeName: store?.store_name ?? "가게",
      marketName: store?.market_name ?? "전통시장",
      storeType: submission.store_type,
      targetMenuName: submission.target_menu_name,
      priceText: submission.price_text,
      appealPoint: submission.appeal_point,
      extraMessage: submission.extra_message,
    },
    stylePreset,
  );
}

export function buildSubmissionVideoScript(
  submission: VideoSubmissionRow,
  stylePreset: VideoStylePreset,
) {
  const store = normalizeVideoStore(submission.stores);

  return buildVideoScript(
    {
      storeName: store?.store_name ?? "가게",
      marketName: store?.market_name ?? "전통시장",
      storeType: submission.store_type,
      targetMenuName: submission.target_menu_name,
      priceText: submission.price_text,
      appealPoint: submission.appeal_point,
      extraMessage: submission.extra_message,
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
