import type { NextRequest } from "next/server";

import QRCode from "qrcode";

import { errorResponse } from "@/lib/api/response";
import { requireAdminApiKey } from "@/lib/auth/admin";
import { buildQrEntryUrl, type QrSlotRecord } from "@/lib/qr/slots";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slotKey: string }> },
) {
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  const { slotKey } = await context.params;

  if (!slotKey?.trim()) {
    return errorResponse("slotKey is required", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const supabase = getSupabaseAdminClient();
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

  const qrValue = buildQrEntryUrl(request.nextUrl.origin, slot.slot_key);
  const svg = await QRCode.toString(qrValue, {
    type: "svg",
    margin: 1,
    width: 512,
    color: {
      dark: "#1f1f1f",
      light: "#ffffff",
    },
  });

  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
