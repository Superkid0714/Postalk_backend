import { mediaObjectExists } from "@/lib/storage/media";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorResponse } from "@/lib/api/response";

export function isStoreUploadPath(bucket: string, filePath: string, storeId: string, assetType?: string) {
  const parts = filePath.split("/");
  return bucket === "uploads" && !filePath.includes("\\") && !filePath.includes("%") &&
    parts.length === 5 && parts.every(part => part.length > 0 && part !== "." && part !== "..") &&
    parts[0] === "stores" && parts[1] === storeId &&
    ["menu_board", "food_photo", "video_clip"].includes(parts[2]) &&
    (!assetType || parts[2] === assetType);
}

export async function verifyStoreUpload(supabase: SupabaseClient, storeId: string, asset: { bucket?: string; filePath?: string }, assetType?: string) {
  const bucket = asset.bucket ?? "uploads";
  const filePath = asset.filePath ?? "";
  if (!isStoreUploadPath(bucket, filePath, storeId, assetType)) {
    return errorResponse("Invalid file reference for this store", 400, { code: "FILE_STORE_MISMATCH" });
  }
  const { data, error } = await mediaObjectExists(supabase, bucket, filePath);
  if (error) return errorResponse("Unable to verify uploaded file", 503, { code: "STORAGE_UNAVAILABLE" });
  if (!data) return errorResponse("Uploaded file not found", 400, { code: "FILE_NOT_FOUND" });
  return null;
}
