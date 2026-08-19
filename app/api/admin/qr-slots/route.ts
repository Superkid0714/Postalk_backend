import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { requireAdminApiKey } from "@/lib/auth/admin";
import {
  buildQrSlotKey,
  buildQrSlotLabel,
  mapQrSlotResponse,
  type QrSlotRecord,
  type StoreSummary,
} from "@/lib/qr/slots";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

export const dynamic = "force-dynamic";

type BootstrapQrSlotsBody = {
  storeId?: string;
};

async function loadQrRecord(storeId: string) {
  const supabase = getSupabaseAdminClient();

  return supabase
    .from("qr_entry_slots")
    .select(
      "id, store_id, slot_number, slot_key, label, is_active, metadata, created_at, updated_at",
    )
    .eq("store_id", storeId)
    .limit(1)
    .maybeSingle<QrSlotRecord>();
}

async function loadStore(storeId: string) {
  const supabase = getSupabaseAdminClient();

  return supabase
    .from("stores")
    .select("id, market_name, store_name")
    .eq("id", storeId)
    .single<StoreSummary>();
}

export async function GET(request: NextRequest) {
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  const storeId = request.nextUrl.searchParams.get("storeId")?.trim();

  if (!storeId) {
    return errorResponse("storeId is required", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "storeId", reason: "storeId is required" }],
    });
  }

  if (!isUuid(storeId)) {
    return errorResponse("Invalid storeId", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "storeId", reason: "storeId must be a valid UUID" }],
    });
  }

  const { data: store, error: storeError } = await loadStore(storeId);

  if (storeError || !store) {
    return errorResponse("Store not found", 404, {
      code: "STORE_NOT_FOUND",
      details: storeError?.message,
    });
  }

  const { data: qr, error: qrError } = await loadQrRecord(storeId);

  if (qrError) {
    return errorResponse("Failed to load merchant QR", 500, {
      code: "MERCHANT_QR_LOAD_FAILED",
      details: qrError.message,
    });
  }

  const origin = request.nextUrl.origin;

  return successResponse(
    {
      store: {
        id: store.id,
        marketName: store.market_name,
        storeName: store.store_name,
      },
      hasQr: Boolean(qr),
      qr: qr ? mapQrSlotResponse(qr, origin, store) : null,
    },
    "Merchant QR loaded",
  );
}

export async function POST(request: NextRequest) {
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  let body: BootstrapQrSlotsBody;

  try {
    body = (await request.json()) as BootstrapQrSlotsBody;
  } catch {
    return errorResponse("Invalid JSON body", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const storeId = body.storeId?.trim();

  if (!storeId) {
    return errorResponse("storeId is required", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "storeId", reason: "storeId is required" }],
    });
  }

  if (!isUuid(storeId)) {
    return errorResponse("Invalid storeId", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "storeId", reason: "storeId must be a valid UUID" }],
    });
  }

  const { data: store, error: storeError } = await loadStore(storeId);

  if (storeError || !store) {
    return errorResponse("Store not found", 404, {
      code: "STORE_NOT_FOUND",
      details: storeError?.message,
    });
  }

  const { data: existingQr, error: existingQrError } = await loadQrRecord(storeId);

  if (existingQrError) {
    return errorResponse("Failed to prepare merchant QR", 500, {
      code: "MERCHANT_QR_PREPARE_FAILED",
      details: existingQrError.message,
    });
  }

  const supabase = getSupabaseAdminClient();
  const rowToInsert = existingQr
    ? null
    : {
        store_id: storeId,
        slot_number: 1,
        slot_key: buildQrSlotKey(store),
        label: buildQrSlotLabel(),
        is_active: true,
        metadata: {},
      };

  if (rowToInsert) {
    const { error: insertError } = await supabase
      .from("qr_entry_slots")
      .insert(rowToInsert);

    if (insertError) {
      return errorResponse("Failed to create merchant QR", 500, {
        code: "MERCHANT_QR_CREATE_FAILED",
        details: insertError.message,
      });
    }
  }

  const { data: finalQr, error: finalQrError } = await loadQrRecord(storeId);

  if (finalQrError || !finalQr) {
    return errorResponse("Failed to load created merchant QR", 500, {
      code: "MERCHANT_QR_LOAD_FAILED",
      details: finalQrError?.message ?? null,
    });
  }

  const origin = request.nextUrl.origin;

  return successResponse(
    {
      store: {
        id: store.id,
        marketName: store.market_name,
        storeName: store.store_name,
      },
      created: Boolean(rowToInsert),
      hasQr: true,
      qr: mapQrSlotResponse(finalQr, origin, store),
    },
    rowToInsert ? "Merchant QR created" : "Merchant QR already exists",
    rowToInsert ? 201 : 200,
  );
}
