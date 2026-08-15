import {
  buildPromoPrompt,
  normalizeStoreRelation,
  type GenerationStylePreset,
} from "@/lib/ai/generation";

export type AdType = "photo" | "video";
export type PublishRequestStatus =
  | "draft"
  | "generating"
  | "generated"
  | "requested_publish"
  | "approved"
  | "rejected";

export type SubmissionWorkflowMetadata = {
  adType?: AdType;
  publishRequestStatus?: PublishRequestStatus;
  currentJobId?: string | null;
  lastCompletedJobId?: string | null;
  generationRequestedAt?: string | null;
  generatedAt?: string | null;
  requestedPublishAt?: string | null;
  regenerateCount?: number;
  lastFailureReason?: string | null;
};

export type SubmissionWorkflowRow = {
  id: string;
  store_id: string;
  title: string | null;
  caption: string | null;
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
  submission_assets?:
    | Array<{
        asset_type: "menu_board" | "food_photo" | "generated_image";
        storage_bucket: string;
        file_path: string;
        sort_order: number;
      }>
    | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getSubmissionWorkflowMetadata(
  aiMetadata: Record<string, unknown> | null | undefined,
): SubmissionWorkflowMetadata {
  if (!isObject(aiMetadata)) {
    return {};
  }

  const workflow = aiMetadata.adWorkflow;

  if (!isObject(workflow)) {
    return {};
  }

  return workflow as SubmissionWorkflowMetadata;
}

export function mergeSubmissionWorkflowMetadata(
  aiMetadata: Record<string, unknown> | null | undefined,
  updates: Partial<SubmissionWorkflowMetadata>,
) {
  const base = isObject(aiMetadata) ? aiMetadata : {};
  const currentWorkflow = getSubmissionWorkflowMetadata(base);

  return {
    ...base,
    adWorkflow: {
      ...currentWorkflow,
      ...updates,
    },
  };
}

export function buildSubmissionPrompt(
  submission: SubmissionWorkflowRow,
  stylePreset: GenerationStylePreset,
) {
  return buildPromoPrompt(
    {
      ...submission,
      stores: normalizeStoreRelation(submission.stores),
    },
    stylePreset,
  );
}

export function hasRequiredPhotoAssets(
  assets:
    | Array<{
        asset_type: "menu_board" | "food_photo" | "generated_image";
      }>
    | null
    | undefined,
) {
  if (!assets || assets.length === 0) {
    return false;
  }

  const hasMenuBoard = assets.some((asset) => asset.asset_type === "menu_board");
  const hasFoodPhoto = assets.some((asset) => asset.asset_type === "food_photo");

  return hasMenuBoard && hasFoodPhoto;
}
