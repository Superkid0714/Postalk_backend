import type { SupabaseClient } from "@supabase/supabase-js";

type StoreLookupParams =
  | {
      storeId: string;
      marketName?: undefined;
      storeName?: undefined;
    }
  | {
      storeId?: undefined;
      marketName: string;
      storeName: string;
    };

export async function resolveStore(
  supabase: SupabaseClient,
  params: StoreLookupParams,
) {
  if ("storeId" in params && params.storeId) {
    return supabase
      .from("stores")
      .select("id, market_name, store_name")
      .eq("id", params.storeId)
      .single();
  }

  return supabase
    .from("stores")
    .select("id, market_name, store_name")
    .eq("market_name", params.marketName)
    .eq("store_name", params.storeName)
    .single();
}
