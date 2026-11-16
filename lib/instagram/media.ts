import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMediaStorage } from "@/lib/storage/media";

type PublishAsset = { asset_type: string; storage_bucket: string; file_path: string; mime_type?: string | null };

/** Instagram supports JPEG images. Preserve the original and upload a deterministic publication copy. */
export async function createInstagramMediaUrl(client: SupabaseClient, asset: PublishAsset) {
  const storage = getMediaStorage(client).from(asset.storage_bucket);
  let filePath = asset.file_path;
  const jpeg = asset.mime_type === "image/jpeg" || !asset.mime_type && /\.jpe?g$/i.test(filePath);
  if (asset.asset_type === "generated_image" && !jpeg) {
    const source = await storage.download(filePath);
    if (source.error || !source.data || source.data.size > 10 * 1024 * 1024) throw new Error("게시할 사진을 불러오지 못했어요.");
    const image = await sharp(Buffer.from(await source.data.arrayBuffer()), { limitInputPixels: 32_000_000 })
      .rotate().flatten({ background: "#ffffff" })
      .resize({ width: 1080, height: 1350, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 }).toBuffer();
    if (image.length > 8 * 1024 * 1024) throw new Error("게시할 사진의 크기가 너무 커요.");
    filePath = `${asset.file_path}.instagram.jpg`;
    const uploaded = await storage.upload(filePath, image, { upsert: true, contentType: "image/jpeg" });
    if (uploaded.error) throw new Error("게시용 사진을 저장하지 못했어요.");
  }
  const signed = await storage.createSignedUrl(filePath, 6 * 60 * 60);
  if (signed.error || !signed.data?.signedUrl) throw new Error("게시용 파일 주소를 만들지 못했어요.");
  return signed.data.signedUrl;
}
