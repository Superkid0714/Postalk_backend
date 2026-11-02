import { createHash, randomUUID } from "node:crypto";
import { exhibitionAccess, exhibitionRoute } from "@/lib/exhibition/access";
import { ExhibitionError, text } from "@/lib/exhibition/contract";
import { inspectMedia } from "@/lib/exhibition/render";
import { successResponse } from "@/lib/api/response";
import { sanitizeFileName } from "@/lib/files";
import { isUuid } from "@/lib/validation";
import { getMediaStorage, getUploadStorageBucket } from "@/lib/storage/media";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST(request: Request) { return exhibitionRoute(async () => {
  let body: FormData;
  try { body = await request.formData(); } catch { throw new ExhibitionError("파일을 읽지 못했어요. 다시 선택해 주세요."); }
  const { storeId } = exhibitionAccess(request, body);
  const creationId = body.get("creationId");
  const sceneNumber = Number(body.get("sceneNumber"));
  if (!isUuid(creationId) || !Number.isInteger(sceneNumber) || sceneNumber < 1 || sceneNumber > 20) throw new ExhibitionError("제작 번호와 장면 번호를 확인해 주세요.");
  const menuId = body.get("menuId") ? text(body.get("menuId"), "메뉴 식별값", 64) : null;
  const file = body.get("file");
  if (!(file instanceof File) || !file.size) throw new ExhibitionError("파일을 선택해 주세요.");
  const image = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  const video = ["video/mp4", "video/quicktime", "video/webm"].includes(file.type);
  if (!image && !video) throw new ExhibitionError("지원하는 사진 또는 영상 파일을 선택해 주세요.", 415, "UNSUPPORTED_MEDIA_TYPE");
  if (file.size > (image ? 10 : 200) * 1024 * 1024) throw new ExhibitionError("파일이 너무 커요. 크기를 줄여 다시 선택해 주세요.", 413, "PAYLOAD_TOO_LARGE");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let metadata;
  try { metadata = await inspectMedia(bytes); } catch { throw new ExhibitionError("파일을 읽지 못했어요. 다른 사진이나 영상으로 다시 시도해 주세요."); }
  if (video && !metadata.durationSeconds) throw new ExhibitionError("영상 길이를 확인하지 못했어요.");
  const supabase = getSupabaseServiceClient();
  const assetId = randomUUID();
  const bucket = getUploadStorageBucket();
  const filePath = `stores/${storeId}/${image ? "food_photo" : "video_clip"}/${assetId}/${sanitizeFileName(file.name)}`;
  const { error: uploadError } = await getMediaStorage(supabase).from(bucket).upload(filePath, bytes, { contentType: file.type, upsert: false });
  if (uploadError) throw new Error(uploadError.message);
  const { error } = await supabase.rpc("register_exhibition_upload", { p_asset: {
    id: assetId, store_id: storeId, creation_id: creationId, scene_number: sceneNumber, menu_id: menuId,
    media_type: image ? "image" : "video", storage_bucket: bucket, file_path: filePath, mime_type: file.type, file_size: file.size,
    duration_seconds: video ? metadata.durationSeconds : null,
    checksum_sha256: createHash("sha256").update(bytes).digest("hex"),
  } });
  if (error?.message.includes("CREATION_ALREADY_STARTED")) throw new ExhibitionError("이미 광고 제작을 시작했어요. 진행 상태를 확인해 주세요.", 409, "CREATION_ALREADY_STARTED");
  if (error) throw new Error(error.message);
  return successResponse({ assetId, sceneNumber, menuId, bucket, filePath, mediaType: image ? "image" : "video", durationSeconds: video ? metadata.durationSeconds : null }, "재료를 올렸어요.", 201);
}); }
