import { createHmac, timingSafeEqual } from "node:crypto";
import { errorResponse } from "@/lib/api/response";
import { ExhibitionError, object } from "@/lib/exhibition/contract";
import { isUuid } from "@/lib/validation";

export function exhibitionConfiguration() {
  if (process.env.EXHIBITION_MODE_ENABLED !== "true") throw new ExhibitionError("요청한 화면을 찾을 수 없어요.", 404, "NOT_FOUND");
  const storeId = process.env.EXHIBITION_STORE_ID;
  if (!isUuid(storeId)) throw new ExhibitionError("전시용 가게 설정을 확인해 주세요.", 503, "EXHIBITION_NOT_CONFIGURED");
  return { storeId };
}
export function exhibitionAccess(request: Request, body?: Record<string, unknown> | FormData) {
  const { storeId } = exhibitionConfiguration();
  const values = [request.headers.get("x-user-id"), new URL(request.url).searchParams.get("user_id"), body instanceof FormData ? body.get("user_id") : body?.user_id].filter(value => value !== null && value !== undefined);
  if (!values.length || values.some(value => value !== 1 && value !== "1")) throw new ExhibitionError("전시 로그인을 다시 확인해 주세요.", 401, "UNAUTHORIZED");
  return { userId: 1, storeId };
}
export function creationToken(creationId: string, storeId: string) {
  const secret = process.env.EXHIBITION_PUBLISH_SECRET;
  if (!secret || secret.length < 32) throw new ExhibitionError("전시 게시 권한 설정을 확인해 주세요.", 503, "EXHIBITION_NOT_CONFIGURED");
  return createHmac("sha256", secret).update(`1:${storeId}:${creationId}`).digest("hex");
}
export function requireCreationToken(request: Request, creationId: string, storeId: string) {
  const expected = Buffer.from(creationToken(creationId, storeId));
  const provided = Buffer.from(request.headers.get("x-creation-token") ?? "");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) throw new ExhibitionError("이 광고를 만든 화면에서만 게시할 수 있어요.", 403, "CREATION_PERMISSION_REQUIRED");
}
export async function exhibitionRoute(action: () => Promise<Response>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof ExhibitionError) return errorResponse(error.message, error.status, { code: error.code });
    console.error("Exhibition API failed", error);
    return errorResponse("요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.", 503, { code: "SERVICE_UNAVAILABLE" });
  }
}
export async function exhibitionJson(request: Request) {
  try { return object(await request.json()); }
  catch { throw new ExhibitionError("입력 내용을 읽지 못했어요. 다시 시도해 주세요."); }
}
