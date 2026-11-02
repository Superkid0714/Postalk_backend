import { exhibitionAccess, exhibitionJson, exhibitionRoute, requireCreationToken } from "@/lib/exhibition/access";
import { ExhibitionError, validateCaption } from "@/lib/exhibition/contract";
import { exhibitionAdDetail, loadExhibitionAd } from "@/lib/exhibition/ads";
import { withPublishLock, PublishBusyError } from "@/lib/instagram/publish-lock";
import { successResponse } from "@/lib/api/response";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Context = { params: Promise<{ adId: string }> };
export async function GET(request: Request, context: Context) { return exhibitionRoute(async () => {
  const { storeId } = exhibitionAccess(request);
  const { adId } = await context.params;
  const detail = await exhibitionAdDetail(adId, storeId);
  let canPublish = false;
  if (request.headers.has("x-creation-token")) {
    const ad = await loadExhibitionAd(adId, storeId);
    try { requireCreationToken(request, ad.creation_id, storeId); canPublish = detail.generationStatus === "completed" && !["published", "publishing"].includes(detail.publishStatus); } catch { /* Missing current-creation permission keeps archive read-only for publishing. */ }
  }
  return successResponse({ ...detail, canPublish });
}); }
export async function PATCH(request: Request, context: Context) { return exhibitionRoute(async () => {
  const body = await exhibitionJson(request);
  const { storeId } = exhibitionAccess(request, body);
  const { adId } = await context.params;
  await loadExhibitionAd(adId, storeId);
  const caption = validateCaption(body.caption);
  try {
    await withPublishLock(adId, async () => {
      const { error } = await getSupabaseServiceClient().rpc("update_exhibition_caption", { p_ad_id: adId, p_store_id: storeId, p_caption: caption });
      if (error?.message.includes("CAPTION_LOCKED") || error?.message.includes("AD_NOT_READY")) throw new ExhibitionError("완성된 게시 전 광고의 캡션만 수정할 수 있어요.", 409, "CAPTION_LOCKED");
      if (error?.message.includes("CAPTION_INVALID")) throw new ExhibitionError("캡션은 2,200자, 해시태그는 30개까지 입력해 주세요.");
      if (error) throw new Error(error.message);
    });
  } catch (error) { if (error instanceof PublishBusyError) throw new ExhibitionError("게시 상태를 확인한 뒤 다시 시도해 주세요.", 409, "PUBLISH_IN_PROGRESS"); throw error; }
  return successResponse({ adId, caption }, "캡션을 저장했어요.");
}); }
export async function DELETE(request: Request, context: Context) { return exhibitionRoute(async () => {
  const body = request.body ? await exhibitionJson(request) : undefined;
  const { storeId } = exhibitionAccess(request, body);
  const { adId } = await context.params;
  await loadExhibitionAd(adId, storeId);
  try {
    await withPublishLock(adId, async () => {
      const { error } = await getSupabaseServiceClient().rpc("delete_exhibition_ad", { p_ad_id: adId, p_store_id: storeId });
      if (error?.message.includes("PUBLISH_IN_PROGRESS")) throw new ExhibitionError("게시가 진행 중이에요. 완료 후 삭제해 주세요.", 409, "PUBLISH_IN_PROGRESS");
      if (error) throw new Error(error.message);
    });
  } catch (error) { if (error instanceof PublishBusyError) throw new ExhibitionError("게시가 진행 중이에요. 잠시 후 다시 시도해 주세요.", 409, "PUBLISH_IN_PROGRESS"); throw error; }
  return successResponse({ adId, deleted: true, instagramPostDeleted: false }, "보관함에서 삭제했어요.");
}); }
