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

export type { QrSlotRecord, StoreSummary };
