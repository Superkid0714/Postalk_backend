import QRCode from "qrcode";
import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/api/response";
import { buildMerchantQrEntryUrl, loadMerchantQrByToken } from "@/lib/merchant-qr";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET(request: NextRequest, context: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = await context.params;
  const { data, error } = await loadMerchantQrByToken(getSupabaseServiceClient(), qrToken);
  if (error) return errorResponse("Unable to load QR", 503, { code: "QR_UNAVAILABLE" });
  if (!data || data.status === "disabled") return errorResponse("QR not found", 404, { code: "NOT_FOUND" });
  const png = await QRCode.toBuffer(buildMerchantQrEntryUrl(request.nextUrl.origin, qrToken), { width: 512, margin: 2 });
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
}
