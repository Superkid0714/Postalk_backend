import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseServiceEnv } from "@/lib/env";

let supabaseServiceClient: SupabaseClient | undefined;

export function getSupabaseServiceClient() {
  if (supabaseServiceClient) {
    return supabaseServiceClient;
  }

  const { serviceRoleKey, url } = getSupabaseServiceEnv();

  supabaseServiceClient = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseServiceClient;
}
