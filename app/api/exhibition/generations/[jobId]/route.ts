import { exhibitionAccess, exhibitionRoute } from "@/lib/exhibition/access";
import { ExhibitionError } from "@/lib/exhibition/contract";
import { exhibitionAdDetail } from "@/lib/exhibition/ads";
import { successResponse } from "@/lib/api/response";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/validation";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) { return exhibitionRoute(async () => {
  const { storeId } = exhibitionAccess(request);
  const { jobId } = await context.params;
  if (!isUuid(jobId)) throw new ExhibitionError("제작 작업 번호를 확인해 주세요.");
  const { data, error } = await getSupabaseServiceClient().from("exhibition_ads").select("id").eq("job_id", jobId).eq("store_id", storeId).is("deleted_at", null).single();
  if (error || !data) throw new ExhibitionError("제작 작업을 찾지 못했어요.", 404, "NOT_FOUND");
  const detail = await exhibitionAdDetail(data.id, storeId);
  return successResponse({ ...detail, status: detail.generationStatus });
}); }
