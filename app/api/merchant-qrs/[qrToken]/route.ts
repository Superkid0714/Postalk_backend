import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  loadMerchantQrByToken,
  loadMerchantQrStore,
  mapMerchantQrResponse,
} from "@/lib/merchant-qr";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ qrToken: string }> },
) {
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

  const { data: store } = await loadMerchantQrStore(
    supabase,
    qr.assigned_store_id,
  );

  return successResponse(
    {
      qr: mapMerchantQrResponse(qr, request.nextUrl.origin, store),
    },
    "Merchant QR loaded",
  );
}
