import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
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

async function openGuestStoreAttempt(
  client: SupabaseClient,
  hash: string,
  names: { storeName?: string; marketName?: string },
  signal: AbortSignal,
) {
  // The unique hash makes a browser retry safe even if the first response was lost.
  const inserted = await client.from("stores").upsert({
    market_name: names.marketName ?? "전통시장",
    store_name: names.storeName ?? "가게",
    guest_session_hash: hash,
  }, { onConflict: "guest_session_hash", ignoreDuplicates: true, defaultToNull: false }).retry(false).abortSignal(signal);

  if (inserted.error) {
    return { operation: "insert" as const, result: inserted };
  }
  if (names.storeName || names.marketName) {
    const updated = await client.from("stores").update({
      ...(names.storeName && { store_name: names.storeName }),
      ...(names.marketName && { market_name: names.marketName }),
    }).eq("guest_session_hash", hash).select("id").abortSignal(signal).retry(false).maybeSingle<{ id: string }>();
    return { operation: "update" as const, result: updated };
  }
  const found = await client.from("stores").select("id").eq("guest_session_hash", hash)
    .abortSignal(signal).retry(false).maybeSingle<{ id: string }>();
  return { operation: "lookup" as const, result: found };
}


function canRetryGuestStore(result: { data: unknown; error: { code: string } | null; status: number }) {
  if (!result.error) return !result.data;
  // Observed upstream 401/PGRST303 on a server-key request; retry only this
  // claims-validation failure, never arbitrary authentication/permission errors.
  return (result.status === 401 && result.error.code === "PGRST303")
    || [0, 408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524].includes(result.status)
    || ["40001", "40P01", "53300", "57P01", "57P02", "57P03", "PGRST000", "PGRST001", "PGRST002", "PGRST003"].includes(result.error.code)
    || result.error.code.startsWith("08");
}

export async function openGuestStore(
  client: SupabaseClient,
  hash: string,
  names: { storeName?: string; marketName?: string },
) {
  for (let attempt = 1; ; attempt++) {
    // The same unique hash and assigned names make this safe even if a write
    // committed but its response was lost. Bound the whole attempt, not each query.
    const { operation, result } = await openGuestStoreAttempt(client, hash, names, AbortSignal.timeout(5000));
    if (attempt >= 3 || !canRetryGuestStore(result)) {
      reportGuestStoreFailure(operation, result);
      return result;
    }
    console.warn("Retrying guest workspace database operation", {
      operation, attempt, status: result.status, code: result.error?.code || null,
    });
    await delay(150 * attempt + Math.floor(Math.random() * 100));
  }
}
