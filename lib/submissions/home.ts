type SubmissionStatus = "draft" | "published";
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
  "generated_image",
  "food_photo",
  "menu_board",
  "generated_video",
];

export function getSubmissionStatusLabel(status: SubmissionStatus) {
  return status === "published" ? "게시 완료" : "보관 중";
}

export function getSubmissionStatusMessage(status: SubmissionStatus) {
  return status === "published" ? "Instagram에 게시된 광고예요" : "완성된 광고를 확인하고 직접 게시할 수 있어요";
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
