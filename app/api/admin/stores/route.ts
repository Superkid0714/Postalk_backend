import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { requireAdminApiKey } from "@/lib/auth/admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type StoreRow = {
  id: string;
  market_name: string;
  store_name: string;
  owner_name: string | null;
  category: string | null;
  created_at: string;
};

type QrSlotSummaryRow = {
  id: string;
  store_id: string;
  slot_key: string;
  is_active: boolean;
};

export async function GET(request: NextRequest) {
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  const marketName = request.nextUrl.searchParams.get("marketName")?.trim() || null;
  const search = request.nextUrl.searchParams.get("search")?.trim() || null;
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit =
    typeof limitParam === "string" && Number.isFinite(Number(limitParam))
      ? Math.min(Math.max(Number(limitParam), 1), 100)
      : 50;

  const supabase = getSupabaseAdminClient();

  let storesQuery = supabase
    .from("stores")
    .select("id, market_name, store_name, owner_name, category, created_at")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (marketName) {
    storesQuery = storesQuery.eq("market_name", marketName);
  }

  if (search) {
    storesQuery = storesQuery.or(
      `store_name.ilike.%${search}%,owner_name.ilike.%${search}%,market_name.ilike.%${search}%`,
    );
  }

  const { data: stores, error: storesError } =
    await storesQuery.returns<StoreRow[]>();

  if (storesError) {
    return errorResponse("Failed to load stores", 500, {
      code: "STORE_LIST_LOAD_FAILED",
      details: storesError.message,
    });
  }

  const storeIds = (stores ?? []).map((store) => store.id);
  const { data: qrSlots, error: qrSlotsError } =
    storeIds.length === 0
      ? { data: [] as QrSlotSummaryRow[], error: null }
      : await supabase
          .from("qr_entry_slots")
          .select("id, store_id, slot_key, is_active")
          .in("store_id", storeIds)
          .returns<QrSlotSummaryRow[]>();

  if (qrSlotsError) {
    return errorResponse("Failed to load QR slot summaries", 500, {
      code: "QR_SLOT_SUMMARY_LOAD_FAILED",
      details: qrSlotsError.message,
    });
  }

  const qrSlotsByStoreId = new Map<string, QrSlotSummaryRow[]>();

  for (const slot of qrSlots ?? []) {
    const current = qrSlotsByStoreId.get(slot.store_id) ?? [];
    current.push(slot);
    qrSlotsByStoreId.set(slot.store_id, current);
  }

  const items = (stores ?? []).map((store) => {
    const qr = (qrSlotsByStoreId.get(store.id) ?? [])[0] ?? null;

    return {
      storeId: store.id,
      marketName: store.market_name,
      storeName: store.store_name,
      ownerName: store.owner_name,
      category: store.category,
      qrSummary: {
        hasQr: Boolean(qr),
        isActive: qr?.is_active ?? false,
        readyToPrint: Boolean(qr?.is_active),
        needsBootstrap: !qr,
        slotKey: qr?.slot_key ?? null,
      },
      createdAt: store.created_at,
    };
  });

  return successResponse(
    {
      items,
      count: items.length,
    },
    "Admin store list loaded",
  );
}
