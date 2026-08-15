type SubmissionStatus = "pending_review" | "approved" | "rejected";
type SubmissionAssetType =
  | "menu_board"
  | "food_photo"
  | "generated_image"
  | "generated_video"
  | "video_thumbnail";

export type SubmissionAssetRecord = {
  asset_type: SubmissionAssetType;
  storage_bucket: string;
  file_path: string;
  sort_order: number;
};

export type SubmissionHomeRecord = {
  id: string;
  title: string | null;
  target_menu_name: string | null;
  status: SubmissionStatus;
  created_at: string;
  updated_at: string;
  submission_assets?: SubmissionAssetRecord[] | null;
};

const THUMBNAIL_PRIORITY: SubmissionAssetType[] = [
  "video_thumbnail",
  "food_photo",
  "generated_image",
  "menu_board",
  "generated_video",
];

export function getSubmissionStatusLabel(status: SubmissionStatus) {
  switch (status) {
    case "pending_review":
      return "승인 대기중";
    case "approved":
      return "승인 완료";
    case "rejected":
      return "보충 필요";
    default:
      return status;
  }
}

export function getSubmissionStatusMessage(status: SubmissionStatus) {
  switch (status) {
    case "pending_review":
      return "운영팀에서 내용을 확인하고 있어요";
    case "approved":
      return "승인이 완료된 광고예요";
    case "rejected":
      return "내용을 보완해서 다시 제출해주세요";
    default:
      return "";
  }
}

export function getSubmissionTitle(
  submission: Pick<SubmissionHomeRecord, "target_menu_name" | "title">,
  storeName: string,
) {
  return submission.target_menu_name || submission.title || storeName;
}

export function pickThumbnailAsset(
  assets: SubmissionAssetRecord[] | null | undefined,
) {
  if (!assets || assets.length === 0) {
    return null;
  }

  const sortedAssets = [...assets].sort((left, right) => left.sort_order - right.sort_order);

  for (const assetType of THUMBNAIL_PRIORITY) {
    const asset = sortedAssets.find((item) => item.asset_type === assetType);

    if (asset) {
      return asset;
    }
  }

  return sortedAssets[0] ?? null;
}
