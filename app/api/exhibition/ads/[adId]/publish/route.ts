import { exhibitionAccess, exhibitionJson, exhibitionRoute, requireCreationToken } from "@/lib/exhibition/access";
import { ExhibitionError, validateCaption } from "@/lib/exhibition/contract";
import { loadExhibitionAd } from "@/lib/exhibition/ads";
import { startInstagramPublishForSubmission, isInstagramConfigured } from "@/lib/instagram/publish";
import { PublishBusyError } from "@/lib/instagram/publish-lock";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { successResponse } from "@/lib/api/response";

export async function POST(request: Request, context: { params: Promise<{ adId: string }> }) { return exhibitionRoute(async () => {
  const body = request.body ? await exhibitionJson(request) : undefined;
  const { storeId } = exhibitionAccess(request, body);
  const { adId } = await context.params;
  const ad = await loadExhibitionAd(adId, storeId);
  requireCreationToken(request, ad.creation_id, storeId);
  const { data, error } = await getSupabaseServiceClient().from("submissions").select("caption").eq("id", adId).single();
  if (error || !data) throw new Error("광고를 불러오지 못했어요.");
  validateCaption(data.caption ?? "");
  if (!isInstagramConfigured()) throw new ExhibitionError("인스타그램 연결 설정을 확인해 주세요.", 503, "INSTAGRAM_NOT_CONFIGURED");
  try {
    const result = await startInstagramPublishForSubmission(adId, { mediaType: ad.format === "reels" ? "video" : "photo" });
    if (!result.ok) throw new ExhibitionError("게시하지 못했어요. 잠시 후 다시 시도해 주세요.", 502, "PUBLISH_FAILED");
    return successResponse({ adId, publishStatus: result.status === "published" ? "published" : "publishing", permalink: result.permalink,
      requiresVerification: result.requiresVerification === true }, result.requiresVerification ? "게시 결과를 확인하고 있어요. 다시 게시하지 않아도 돼요." : "게시 요청을 보냈어요.", result.status === "processing" ? 202 : 200);
  } catch (error) { if (error instanceof PublishBusyError) throw new ExhibitionError("이미 게시를 진행하고 있어요.", 409, "PUBLISH_IN_PROGRESS"); throw error; }
}); }
