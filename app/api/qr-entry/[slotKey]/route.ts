import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { errorResponse } from "@/lib/api/response";
import { loadMerchantQrByToken } from "@/lib/merchant-qr";
import { type QrSlotRecord } from "@/lib/qr/slots";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

function buildRedirectTarget(
  request: NextRequest,
  params: {
    qrToken?: string;
    slotKey?: string;
    storeId?: string | null;
    slotNumber?: number | null;
  },
) {
  const redirectTemplate = process.env.QR_ENTRY_REDIRECT_URL_TEMPLATE?.trim();

  if (redirectTemplate) {
    return redirectTemplate
      .replaceAll("{qrToken}", encodeURIComponent(params.qrToken ?? ""))
      .replaceAll("{slotKey}", encodeURIComponent(params.slotKey ?? ""))
      .replaceAll("{storeId}", encodeURIComponent(params.storeId ?? ""))
      .replaceAll(
        "{slotNumber}",
        encodeURIComponent(String(params.slotNumber ?? "")),
      );
  }

  const fallbackUrl = new URL("/", request.nextUrl.origin);

  if (params.qrToken) {
    fallbackUrl.searchParams.set("qrToken", params.qrToken);
  }

  if (params.slotKey) {
    fallbackUrl.searchParams.set("slotKey", params.slotKey);
  }

  if (params.storeId) {
    fallbackUrl.searchParams.set("storeId", params.storeId);
  }

  if (typeof params.slotNumber === "number") {
    fallbackUrl.searchParams.set("slotNumber", String(params.slotNumber));
  }

  return fallbackUrl.toString();
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slotKey: string }> },
) {
  const { slotKey } = await context.params;

  if (!slotKey?.trim()) {
    return errorResponse("slotKey is required", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const supabase = getSupabaseAdminClient();
  const { data: merchantQr } = await loadMerchantQrByToken(supabase, slotKey);

  if (merchantQr) {
    if (merchantQr.status === "disabled") {
      return errorResponse("Merchant QR is inactive", 410, {
        code: "MERCHANT_QR_INACTIVE",
      });
    }

    const redirectTarget = buildRedirectTarget(request, {
      qrToken: merchantQr.qr_token,
      storeId: merchantQr.assigned_store_id,
      slotNumber: 1,
    });

    return NextResponse.redirect(redirectTarget, 307);
  }

  const { data: slot, error: slotError } = await supabase
    .from("qr_entry_slots")
    .select(
      "id, store_id, slot_number, slot_key, label, is_active, metadata, created_at, updated_at",
    )
    .eq("slot_key", slotKey)
    .single<QrSlotRecord>();

  if (slotError || !slot) {
    return errorResponse("QR slot not found", 404, {
      code: "QR_SLOT_NOT_FOUND",
      details: slotError?.message,
    });
  }

  if (!slot.is_active) {
    return errorResponse("QR slot is inactive", 410, {
      code: "QR_SLOT_INACTIVE",
    });
  }

  const redirectTarget = buildRedirectTarget(request, {
    slotKey: slot.slot_key,
    storeId: slot.store_id,
    slotNumber: slot.slot_number,
  });

  return NextResponse.redirect(redirectTarget, 307);
}
