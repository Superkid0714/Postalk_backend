import { ExhibitionError } from "@/lib/exhibition/contract";

const MiB = 1024 * 1024;
export const exhibitionMediaPolicy = {
  image: { maxBytes: 10 * MiB, mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
  video: { maxBytes: 50 * MiB, mimeTypes: ["video/mp4", "video/quicktime", "video/webm"] },
  maxRequestBytes: 52 * MiB,
};

export function validateUploadFile(file: unknown): { file: File; mediaType: "image" | "video" } {
  if (!(file instanceof File) || !file.size) throw new ExhibitionError("파일을 선택해 주세요.");
  const mediaType = exhibitionMediaPolicy.image.mimeTypes.includes(file.type) ? "image"
    : exhibitionMediaPolicy.video.mimeTypes.includes(file.type) ? "video" : null;
  if (!mediaType) throw new ExhibitionError("지원하는 사진 또는 영상 파일을 선택해 주세요.", 415, "UNSUPPORTED_MEDIA_TYPE");
  if (file.size > exhibitionMediaPolicy[mediaType].maxBytes) throw new ExhibitionError(`${mediaType === "image" ? "사진은 10" : "영상은 50"}MiB 이하로 올려 주세요. 크기를 줄여 다시 선택해 주세요.`, 413, "PAYLOAD_TOO_LARGE");
  return { file, mediaType };
}

// Enforce the actual size even when Content-Length is absent or wrong.
export async function readUploadForm(request: Request, maxBytes = exhibitionMediaPolicy.maxRequestBytes) {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw new ExhibitionError("파일 요청 크기를 확인해 주세요.");
  const tooLarge = () => new ExhibitionError("한 번에 파일 하나씩, 영상은 50MiB 이하로 올려 주세요.", 413, "PAYLOAD_TOO_LARGE");
  if (length && Number(length) > maxBytes) throw tooLarge();
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data(?:;|$)/i.test(contentType)) throw new ExhibitionError("파일 업로드 형식을 확인해 주세요.", 415, "UNSUPPORTED_MEDIA_TYPE");
  if (!request.body) throw new ExhibitionError("파일을 선택해 주세요.");
  let bytes = 0;
  let exceeded = false;
  const stream = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) { exceeded = true; controller.error(tooLarge()); return; }
      controller.enqueue(chunk);
    },
  }));
  try {
    const form = await new Response(stream, { headers: { "content-type": contentType } }).formData();
    if (form.getAll("file").length !== 1) throw new ExhibitionError("한 번에 파일 하나만 올려 주세요.");
    return form;
  } catch (error) {
    if (exceeded) throw tooLarge();
    if (error instanceof ExhibitionError) throw error;
    throw new ExhibitionError("파일을 읽지 못했어요. 다시 선택해 주세요.");
  }
}

export function storageUploadFailure(error: unknown): ExhibitionError {
  const value = error as { status?: number; statusCode?: string | number; message?: string } | null;
  const status = Number(value?.statusCode ?? value?.status);
  const message = value?.message ?? "";
  if (status === 413 || /payload too large|maximum allowed size|exceeds.*size/i.test(message)) return new ExhibitionError("저장소의 파일 크기 제한을 초과했어요. 파일 크기를 줄여 주세요.", 413, "PAYLOAD_TOO_LARGE");
  if (/quota|storage.*limit|insufficient storage/i.test(message)) return new ExhibitionError("파일 저장 한도 확인이 필요해요. 현장 담당자에게 알려 주세요.", 507, "STORAGE_QUOTA_EXCEEDED");
  if (status === 429) return new ExhibitionError("업로드 요청이 많아요. 잠시 후 다시 시도해 주세요.", 429, "UPLOAD_BUSY");
  return new ExhibitionError("파일을 저장하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.", 503, "STORAGE_UNAVAILABLE");
}
