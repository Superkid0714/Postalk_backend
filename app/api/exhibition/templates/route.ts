import { exhibitionAccess, exhibitionJson, exhibitionRoute } from "@/lib/exhibition/access";
import { ExhibitionError, parseInfo, text } from "@/lib/exhibition/contract";
import { successResponse } from "@/lib/api/response";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET(request: Request) { return exhibitionRoute(async () => {
  const { storeId } = exhibitionAccess(request);
  const { data, error } = await getSupabaseServiceClient().from("input_templates")
    .select("id,name,store_description,menus,created_at").eq("store_id", storeId).eq("user_id", 1).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return successResponse({ items: (data ?? []).map(row => ({ templateId: row.id, name: row.name, storeDescription: row.store_description, menus: row.menus, createdAt: row.created_at })) });
}); }
export async function POST(request: Request) { return exhibitionRoute(async () => {
  const body = await exhibitionJson(request);
  const { storeId } = exhibitionAccess(request, body);
  const info = parseInfo(body);
  const { data, error } = await getSupabaseServiceClient().from("input_templates").insert({
    store_id: storeId, name: text(body.name, "템플릿 이름", 100), store_description: info.storeDescription, menus: info.menus,
  }).select("id").single();
  if (error || !data) throw new ExhibitionError("템플릿을 저장하지 못했어요. 다시 시도해 주세요.", 503, "TEMPLATE_SAVE_FAILED");
  return successResponse({ templateId: data.id }, "새 템플릿으로 저장했어요.", 201);
}); }
