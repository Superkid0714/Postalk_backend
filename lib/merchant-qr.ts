import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getStoreCategoryLabel } from "@/lib/store-categories";

type MerchantQrStatus = "ready" | "activated" | "disabled";

type MerchantQrRecord = {
  id: string;
  qr_token: string;
  status: MerchantQrStatus;
  assigned_store_id: string | null;
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
};

type MerchantQrStoreRecord = {
  id: string;
  market_name: string;
  store_name: string;
  owner_name: string | null;
  category: string | null;
  description: string | null;
};

export function buildMerchantQrToken() {
  return `merchant-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

export function buildMerchantQrEntryUrl(origin: string, qrToken: string) {
  return `${origin}/api/qr-entry/${qrToken}`;
}

export async function loadMerchantQrByToken(
  supabase: SupabaseClient,
  qrToken: string,
) {
  return supabase
    .from("merchant_qr_tokens")
    .select(
      "id, qr_token, status, assigned_store_id, assigned_at, created_at, updated_at",
    )
    .eq("qr_token", qrToken)
    .maybeSingle<MerchantQrRecord>();
}

export async function loadMerchantQrStore(
  supabase: SupabaseClient,
  assignedStoreId: string | null,
) {
  if (!assignedStoreId) {
    return { data: null as MerchantQrStoreRecord | null, error: null };
  }

  return supabase
    .from("stores")
    .select("id, market_name, store_name, owner_name, category, description")
    .eq("id", assignedStoreId)
    .maybeSingle<MerchantQrStoreRecord>();
}

export async function resolveActivatedStoreFromQrToken(
  supabase: SupabaseClient,
  qrToken: string,
) {
  const qrResult = await loadMerchantQrByToken(supabase, qrToken);

  if (qrResult.error || !qrResult.data || !qrResult.data.assigned_store_id) {
    return {
      qr: qrResult.data ?? null,
      store: null as MerchantQrStoreRecord | null,
      error: qrResult.error ?? null,
    };
  }

  const storeResult = await loadMerchantQrStore(
    supabase,
    qrResult.data.assigned_store_id,
  );

  return {
    qr: qrResult.data,
    store: storeResult.data ?? null,
    error: storeResult.error ?? null,
  };
}

export function mapMerchantQrResponse(
  record: MerchantQrRecord,
  origin: string,
  store?: MerchantQrStoreRecord | null,
) {
  return {
    id: record.id,
    qrToken: record.qr_token,
    status: record.status,
    isAssigned: Boolean(record.assigned_store_id),
    entryUrl: buildMerchantQrEntryUrl(origin, record.qr_token),
    qrImageUrl: `${origin}/api/admin/merchant-qrs/${record.qr_token}/image`,
    assignedAt: record.assigned_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    store: store
      ? {
          id: store.id,
          marketName: store.market_name,
          storeName: store.store_name,
          ownerName: store.owner_name,
          category: store.category,
          categoryLabel: getStoreCategoryLabel(store.category),
          description: store.description,
          locationAddress: store.description,
        }
      : null,
  };
}

export type { MerchantQrRecord, MerchantQrStatus, MerchantQrStoreRecord };
