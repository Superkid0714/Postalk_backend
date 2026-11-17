import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseServiceEnv } from "@/lib/env";
import { createServiceFetch } from "./service-fetch";

let supabaseServiceClient: SupabaseClient | undefined;

export function getSupabaseServiceClient() {
  if (supabaseServiceClient) {
    return supabaseServiceClient;
  }

  const { serviceRoleKey, url } = getSupabaseServiceEnv();

  supabaseServiceClient = createClient(url, serviceRoleKey, {
    global: { fetch: createServiceFetch(serviceRoleKey) },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseServiceClient;
}
