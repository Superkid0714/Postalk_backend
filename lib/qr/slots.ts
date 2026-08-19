import { randomUUID } from "node:crypto";

type StoreSummary = {
  id: string;
  market_name: string;
  store_name: string;
};

type QrSlotRecord = {
  id: string;
  store_id: string;
  slot_number: number;
  slot_key: string;
  label: string | null;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function slugifyKoreanSafe(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9가-힣-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildQrSlotLabel() {
  return "상인 전용 QR";
}

export function buildQrSlotKey(store: StoreSummary) {
  const marketSlug = slugifyKoreanSafe(store.market_name) || "market";
  const storeSlug = slugifyKoreanSafe(store.store_name) || "store";
  const uniqueSuffix = randomUUID().slice(0, 8);

  return `${marketSlug}-${storeSlug}-merchant-${uniqueSuffix}`;
}

export function buildQrEntryUrl(origin: string, slotKey: string) {
  return `${origin}/api/qr-entry/${slotKey}`;
}

export function mapQrSlotResponse(
  slot: QrSlotRecord,
  origin: string,
  store?: StoreSummary | null,
) {
  return {
    id: slot.id,
    storeId: slot.store_id,
    store: store
      ? {
          id: store.id,
          marketName: store.market_name,
          storeName: store.store_name,
        }
      : null,
    slotKey: slot.slot_key,
    label: buildQrSlotLabel(),
    isActive: slot.is_active,
    qrValue: buildQrEntryUrl(origin, slot.slot_key),
    qrImageUrl: `${origin}/api/admin/qr-slots/${slot.slot_key}/image`,
    metadata: slot.metadata ?? {},
    createdAt: slot.created_at,
    updatedAt: slot.updated_at,
  };
}

export type { QrSlotRecord, StoreSummary };
