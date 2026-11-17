import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const GUEST_SESSION_HEADER = "x-guest-session";

export function guestCreationEnabled() {
  return process.env.GUEST_CREATION_ENABLED === "true";
}

export function guestSessionHash(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}

export function findGuestStore(client: SupabaseClient, hash: string) {
  return client.from("stores").select("id").eq("guest_session_hash", hash)
    .maybeSingle<{ id: string }>();
}

function reportGuestStoreFailure(
  operation: "insert" | "update" | "lookup",
  result: { data: unknown; error: { code: string } | null; status: number },
) {
  if (result.error || !result.data) {
    // Database messages/details can contain names or session hashes. Log only codes.
    console.error("Guest workspace database operation failed", {
      operation,
      status: result.status,
      code: result.error?.code || null,
      emptyResult: !result.error && !result.data,
    });
  }
}

export async function openGuestStore(
  client: SupabaseClient,
  hash: string,
  names: { storeName?: string; marketName?: string },
) {
  // The unique hash makes a browser retry safe even if the first response was lost.
  const inserted = await client.from("stores").upsert({
    market_name: names.marketName ?? "전통시장",
    store_name: names.storeName ?? "가게",
    guest_session_hash: hash,
  }, { onConflict: "guest_session_hash", ignoreDuplicates: true, defaultToNull: false });

  if (inserted.error) {
    reportGuestStoreFailure("insert", inserted);
    return { data: null, error: inserted.error };
  }
  if (names.storeName || names.marketName) {
    const updated = await client.from("stores").update({
      ...(names.storeName && { store_name: names.storeName }),
      ...(names.marketName && { market_name: names.marketName }),
    }).eq("guest_session_hash", hash).select("id").maybeSingle<{ id: string }>();
    reportGuestStoreFailure("update", updated);
    return updated;
  }
  const found = await findGuestStore(client, hash);
  reportGuestStoreFailure("lookup", found);
  return found;
}
