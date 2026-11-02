import { exhibitionAccess, exhibitionRoute } from "@/lib/exhibition/access";
import { ExhibitionError } from "@/lib/exhibition/contract";
import { successResponse } from "@/lib/api/response";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/validation";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) { return exhibitionRoute(async () => {
  const { storeId } = exhibitionAccess(request);
  const { jobId } = await context.params;
  if (!isUuid(jobId)) throw new ExhibitionError("대본 작업 번호를 확인해 주세요.");
  const { data, error } = await getSupabaseServiceClient().from("script_jobs").select("id,status,result,failure_reason").eq("id", jobId).eq("store_id", storeId).eq("user_id", 1).single();
  if (error || !data) throw new ExhibitionError("대본 작업을 찾지 못했어요.", 404, "NOT_FOUND");
  return successResponse({ jobId: data.id, status: data.status, scenes: data.result?.scenes ?? [], source: data.result?.source ?? null, message: data.failure_reason });
}); }
