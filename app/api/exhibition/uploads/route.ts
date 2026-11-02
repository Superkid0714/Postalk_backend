import { createHash, randomUUID } from "node:crypto";
import { exhibitionAccess, exhibitionConfiguration, exhibitionRoute } from "@/lib/exhibition/access";
import { ExhibitionError, text } from "@/lib/exhibition/contract";
import { inspectMedia } from "@/lib/exhibition/render";
import { successResponse } from "@/lib/api/response";
import { sanitizeFileName } from "@/lib/files";
import { isUuid } from "@/lib/validation";
import { getMediaStorage, getUploadStorageBucket } from "@/lib/storage/media";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { exhibitionMediaPolicy, readUploadForm, storageUploadFailure, validateUploadFile } from "@/lib/exhibition/media-policy";

export async function GET(request: Request) { return exhibitionRoute(async () => {
  exhibitionAccess(request);
  return successResponse(exhibitionMediaPolicy);
}); }

export async function POST(request: Request) { return exhibitionRoute(async () => {
  exhibitionConfiguration();
  const body = await readUploadForm(request);
  const { storeId } = exhibitionAccess(request, body);
  const creationId = body.get("creationId");
  const sceneNumber = Number(body.get("sceneNumber"));
  if (!isUuid(creationId) || !Number.isInteger(sceneNumber) || sceneNumber < 1 || sceneNumber > 20) throw new ExhibitionError("제작 번호와 장면 번호를 확인해 주세요.");
  const menuId = body.get("menuId") ? text(body.get("menuId"), "메뉴 식별값", 64) : null;
  const { file, mediaType } = validateUploadFile(body.get("file"));
  const image = mediaType === "image";
  const video = mediaType === "video";
  const supabase = getSupabaseServiceClient();
  const { data: existing, error: lookupError } = await supabase.from("contents").select("id")
    .eq("store_id", storeId).eq("creation_id", creationId).maybeSingle();
  if (lookupError) throw new ExhibitionError("제작 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.", 503, "SERVICE_UNAVAILABLE");
  if (existing) throw new ExhibitionError("이미 광고 제작을 시작했어요. 진행 상태를 확인해 주세요.", 409, "CREATION_ALREADY_STARTED");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let metadata;
  try { metadata = await inspectMedia(bytes); } catch { throw new ExhibitionError("파일을 읽지 못했어요. 다른 사진이나 영상으로 다시 시도해 주세요."); }
  if (video && !metadata.durationSeconds) throw new ExhibitionError("영상 길이를 확인하지 못했어요.");
  const assetId = randomUUID();
  const bucket = getUploadStorageBucket();
  const filePath = `stores/${storeId}/${image ? "food_photo" : "video_clip"}/${assetId}/${sanitizeFileName(file.name)}`;
  const { error: uploadError } = await getMediaStorage(supabase).from(bucket).upload(filePath, bytes, { contentType: file.type, upsert: false });
  if (uploadError) throw storageUploadFailure(uploadError);
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
