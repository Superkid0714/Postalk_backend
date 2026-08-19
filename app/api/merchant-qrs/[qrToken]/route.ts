import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  loadMerchantQrByToken,
  loadMerchantQrStore,
  mapMerchantQrResponse,
} from "@/lib/merchant-qr";
import { getPhotoGuideByCategory } from "@/lib/photo-guides";
import { isStoreCategoryCode, STORE_CATEGORY_OPTIONS } from "@/lib/store-categories";
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

  if (
    qr.assigned_store_id &&
    (!store ||
      !store.id?.trim() ||
      !store.market_name?.trim() ||
      !store.store_name?.trim())
  ) {
    return errorResponse("Assigned store details not found", 500, {
      code: "MERCHANT_QR_STORE_LOAD_FAILED",
      details: {
        assignedStoreId: qr.assigned_store_id,
        message:
          "Connected QR must include store id, marketName, and storeName",
      },
    });
  }

  return successResponse(
    {
      qr: mapMerchantQrResponse(qr, request.nextUrl.origin, store),
      onboarding: {
        needsCategorySelection:
          qr.status === "ready" || !store?.category?.trim(),
        needsLocationCapture:
          qr.status === "ready" ||
          !store?.description?.trim(),
        categoryOptions: STORE_CATEGORY_OPTIONS,
        selectedCategory: store?.category ?? null,
        photoGuide: isStoreCategoryCode(store?.category)
          ? getPhotoGuideByCategory(store.category)
          : null,
      },
    },
    "Merchant QR loaded",
  );
}
