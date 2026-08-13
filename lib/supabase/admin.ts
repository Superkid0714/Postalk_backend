import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminEnv } from "@/lib/env";

let supabaseAdminClient: SupabaseClient | undefined;

export function getSupabaseAdminClient() {
  if (supabaseAdminClient) {
    return supabaseAdminClient;
  }

  const { serviceRoleKey, url } = getSupabaseAdminEnv();

  supabaseAdminClient = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseAdminClient;
}
