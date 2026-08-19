import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  loadMerchantQrByToken,
  loadMerchantQrStore,
  mapMerchantQrResponse,
  type MerchantQrStoreRecord,
} from "@/lib/merchant-qr";
import { getPhotoGuideByCategory } from "@/lib/photo-guides";
import {
  isStoreCategoryCode,
  STORE_CATEGORY_OPTIONS,
  type StoreCategoryCode,
} from "@/lib/store-categories";
import { resolveStore } from "@/lib/stores";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type ActivateMerchantQrBody = {
  marketName?: string;
  storeName?: string;
  ownerName?: string;
  category?: string;
  locationAddress?: string;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ qrToken: string }> },
) {
  const { qrToken } = await context.params;

  if (!qrToken?.trim()) {
    return errorResponse("qrToken is required", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  let body: ActivateMerchantQrBody;

  try {
    body = (await request.json()) as ActivateMerchantQrBody;
  } catch {
    return errorResponse("Invalid JSON body", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  if (!body.marketName?.trim()) {
    return errorResponse("marketName is required", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "marketName", reason: "marketName is required" }],
    });
  }

  if (!body.storeName?.trim()) {
    return errorResponse("storeName is required", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "storeName", reason: "storeName is required" }],
    });
  }

  if (!body.category?.trim()) {
    return errorResponse("category is required", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "category", reason: "category is required" }],
    });
  }

  if (!isStoreCategoryCode(body.category)) {
    return errorResponse("Invalid category", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "category", reason: "category must be one of the supported store categories" }],
    });
  }

  const category = body.category.trim() as StoreCategoryCode;

  if (!body.locationAddress?.trim()) {
    return errorResponse("locationAddress is required", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "locationAddress", reason: "locationAddress is required" }],
    });
  }

  const supabase = getSupabaseAdminClient();
  const { data: qr, error: qrError } = await loadMerchantQrByToken(supabase, qrToken);

  if (qrError || !qr) {
    return errorResponse("Merchant QR not found", 404, {
      code: "MERCHANT_QR_NOT_FOUND",
      details: qrError?.message,
    });
  }

  if (qr.status === "disabled") {
    return errorResponse("Merchant QR is disabled", 410, {
      code: "MERCHANT_QR_DISABLED",
    });
  }

  let store: MerchantQrStoreRecord | null = null;

  if (qr.assigned_store_id) {
    const storeResult = await loadMerchantQrStore(supabase, qr.assigned_store_id);
    store = storeResult.data ?? null;

    if (store && store.category !== body.category.trim()) {
      const { error: updateStoreError } = await supabase
        .from("stores")
        .update({
          category,
          location_address: body.locationAddress?.trim() || null,
        })
        .eq("id", store.id);

      if (updateStoreError) {
        return errorResponse("Failed to update store category", 500, {
          code: "STORE_CATEGORY_UPDATE_FAILED",
          details: updateStoreError.message,
        });
      }

      const refreshedStoreResult = await loadMerchantQrStore(supabase, qr.assigned_store_id);
      store = refreshedStoreResult.data ?? store;
    }
    if (
      store &&
      store.category === category &&
      (store.location_address ?? null) !== (body.locationAddress?.trim() || null)
    ) {
      const { error: updateLocationError } = await supabase
        .from("stores")
        .update({
          location_address: body.locationAddress?.trim() || null,
        })
        .eq("id", store.id);

      if (updateLocationError) {
        return errorResponse("Failed to update store location", 500, {
          code: "STORE_LOCATION_UPDATE_FAILED",
          details: updateLocationError.message,
        });
      }

      const refreshedStoreResult = await loadMerchantQrStore(supabase, qr.assigned_store_id);
      store = refreshedStoreResult.data ?? store;
    }
  } else {
    const existingStoreResult = await resolveStore(supabase, {
      marketName: body.marketName.trim(),
      storeName: body.storeName.trim(),
    });

    let assignedStoreId = existingStoreResult.data?.id ?? null;

    if (!assignedStoreId) {
      const { data: createdStore, error: createdStoreError } = await supabase
        .from("stores")
        .insert({
          market_name: body.marketName.trim(),
          store_name: body.storeName.trim(),
          owner_name: body.ownerName?.trim() || null,
          category,
          latitude: null,
          longitude: null,
          location_address: body.locationAddress?.trim() || null,
        })
        .select("id")
        .single<{ id: string }>();

      if (createdStoreError || !createdStore) {
        return errorResponse("Failed to create store", 500, {
          code: "STORE_CREATE_FAILED",
          details: createdStoreError?.message,
        });
      }

      assignedStoreId = createdStore.id;
    } else if (body.category.trim()) {
      const { error: updateExistingStoreError } = await supabase
        .from("stores")
        .update({
          category,
          location_address: body.locationAddress?.trim() || null,
        })
        .eq("id", assignedStoreId);

      if (updateExistingStoreError) {
        return errorResponse("Failed to update existing store category", 500, {
          code: "STORE_CATEGORY_UPDATE_FAILED",
          details: updateExistingStoreError.message,
        });
      }
    }

    const { error: assignError } = await supabase
      .from("merchant_qr_tokens")
      .update({
        status: "activated",
        assigned_store_id: assignedStoreId,
        assigned_at: new Date().toISOString(),
      })
      .eq("id", qr.id);

    if (assignError) {
      return errorResponse("Failed to activate merchant QR", 500, {
        code: "MERCHANT_QR_ACTIVATE_FAILED",
        details: assignError.message,
      });
    }

    const storeResult = await loadMerchantQrStore(supabase, assignedStoreId);
    store = storeResult.data ?? null;
  }

  const { data: finalQr, error: finalQrError } = await loadMerchantQrByToken(
    supabase,
    qrToken,
  );

  if (finalQrError || !finalQr) {
    return errorResponse("Failed to load activated merchant QR", 500, {
      code: "MERCHANT_QR_LOAD_FAILED",
      details: finalQrError?.message,
    });
  }

  return successResponse(
    {
      qr: mapMerchantQrResponse(finalQr, request.nextUrl.origin, store),
      store,
      onboarding: {
        needsCategorySelection: false,
        needsLocationCapture: false,
        categoryOptions: STORE_CATEGORY_OPTIONS,
        selectedCategory: category,
        photoGuide: getPhotoGuideByCategory(category),
      },
    },
    qr.assigned_store_id ? "Merchant QR already activated" : "Merchant QR activated",
    qr.assigned_store_id ? 200 : 201,
  );
}
