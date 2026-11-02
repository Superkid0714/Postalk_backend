import { after } from "next/server";
import { exhibitionAccess, exhibitionJson, exhibitionRoute, requireCreationToken } from "@/lib/exhibition/access";
import { ExhibitionError } from "@/lib/exhibition/contract";
import { loadExhibitionAd } from "@/lib/exhibition/ads";
import { processExhibitionJob } from "@/lib/exhibition/process";
import { successResponse } from "@/lib/api/response";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST(request: Request, context: { params: Promise<{ adId: string }> }) { return exhibitionRoute(async () => {
  const body = request.body ? await exhibitionJson(request) : undefined;
  const { storeId } = exhibitionAccess(request, body);
  const { adId } = await context.params;
  const ad = await loadExhibitionAd(adId, storeId);
  requireCreationToken(request, ad.creation_id, storeId);
  const { data: jobId, error } = await getSupabaseServiceClient().rpc("retry_exhibition_generation", { p_ad_id: adId, p_store_id: storeId });
  if (error) throw new ExhibitionError("현재 광고는 다시 제작할 수 없어요.", 409, "AD_NOT_READY");
  after(async () => { try { await processExhibitionJob(jobId); } catch (error) { console.error("Exhibition retry failed", { jobId, error }); } });
  return successResponse({ adId, jobId }, "다시 제작을 요청했어요.", 202);
}); }
