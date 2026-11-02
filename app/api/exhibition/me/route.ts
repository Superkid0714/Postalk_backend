import { exhibitionAccess, exhibitionRoute } from "@/lib/exhibition/access";
import { successResponse } from "@/lib/api/response";
import { ExhibitionError } from "@/lib/exhibition/contract";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET(request: Request) { return exhibitionRoute(async () => {
  const { storeId } = exhibitionAccess(request);
  const { data, error } = await getSupabaseServiceClient().from("stores").select("id,store_name,market_name,location_address").eq("id", storeId).single();
  if (error || !data) throw new ExhibitionError("전시용 가게 정보를 확인해 주세요.", 503, "EXHIBITION_NOT_CONFIGURED");
  return successResponse({ user_id: 1, store: { storeId: data.id, name: data.store_name, address: data.location_address, marketName: data.market_name } });
}); }
