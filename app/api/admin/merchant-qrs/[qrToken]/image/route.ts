import type { NextRequest } from "next/server";

import QRCode from "qrcode";

import { errorResponse } from "@/lib/api/response";
import { requireAdminApiKey } from "@/lib/auth/admin";
import {
  buildMerchantQrEntryUrl,
  loadMerchantQrByToken,
} from "@/lib/merchant-qr";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ qrToken: string }> },
) {
  const adminAuth = requireAdminApiKey(request);

  if (!adminAuth.ok) {
    return adminAuth.response;
  }

  const { qrToken } = await context.params;

  if (!qrToken?.trim()) {
    return errorResponse("qrToken is required", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const supabase = getSupabaseAdminClient();
  const { data: qr, error } = await loadMerchantQrByToken(supabase, qrToken);

  if (error || !qr) {
    return errorResponse("Merchant QR not found", 404, {
      code: "MERCHANT_QR_NOT_FOUND",
      details: error?.message,
    });
  }

  const qrValue = buildMerchantQrEntryUrl(request.nextUrl.origin, qr.qr_token);
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
