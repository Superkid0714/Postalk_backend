import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { reviewPhotoAsset } from "@/lib/ai/photo-review";
import { findPhotoGuideShot } from "@/lib/photo-guides";
import { resolveActivatedStoreFromQrToken } from "@/lib/merchant-qr";
import { resolveStore } from "@/lib/stores";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  isStoreCategoryCode,
  type StoreCategoryCode,
} from "@/lib/store-categories";
import { isUuid } from "@/lib/validation";

type PhotoCheckBody = {
  qrToken?: string;
  storeId?: string;
  marketName?: string;
  storeName?: string;
  bucket?: string;
  filePath?: string;
  assetType?: "menu_board" | "food_photo";
  category?: string;
  shotOrder?: number;
};

function isPhotoAssetType(value: unknown): value is "menu_board" | "food_photo" {
  return value === "menu_board" || value === "food_photo";
}

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: PhotoCheckBody;

  try {
    body = (await request.json()) as PhotoCheckBody;
  } catch {
    return errorResponse("Invalid JSON body", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const details: Array<{ field: string; reason: string }> = [];

  if (!body.filePath?.trim()) {
    details.push({
      field: "filePath",
      reason: "filePath is required",
    });
  }

  if (!body.bucket?.trim()) {
    details.push({
      field: "bucket",
      reason: "bucket is required",
    });
  }

  if (!isPhotoAssetType(body.assetType)) {
    details.push({
      field: "assetType",
      reason: "assetType must be 'menu_board' or 'food_photo'",
    });
  }

  if (!body.category?.trim() || !isStoreCategoryCode(body.category)) {
    details.push({
      field: "category",
      reason: "category must be one of the supported store categories",
    });
  }

  const hasQrToken = typeof body.qrToken === "string" && body.qrToken.trim();
  const hasStoreId = typeof body.storeId === "string" && body.storeId.trim();
  const hasStoreNames =
    typeof body.marketName === "string" &&
    body.marketName.trim() &&
    typeof body.storeName === "string" &&
    body.storeName.trim();

  if (!hasQrToken && !hasStoreId && !hasStoreNames) {
    details.push({
      field: "store",
      reason: "Provide qrToken, storeId, or both marketName and storeName",
    });
  }

  if (hasStoreId && !isUuid(body.storeId!)) {
    details.push({
      field: "storeId",
      reason: "storeId must be a valid UUID",
    });
  }

  if (
    typeof body.shotOrder !== "undefined" &&
    (!Number.isFinite(body.shotOrder) || body.shotOrder < 1)
  ) {
    details.push({
      field: "shotOrder",
      reason: "shotOrder must be a positive number",
    });
  }

  if (details.length > 0) {
    return errorResponse("Invalid request body", 400, {
      code: "VALIDATION_ERROR",
      details,
    });
  }

  const category = body.category!.trim() as StoreCategoryCode;
  const supabase = getSupabaseAdminClient();

  const activatedQrStoreLookup =
    body.qrToken?.trim()
      ? await resolveActivatedStoreFromQrToken(supabase, body.qrToken.trim())
      : null;

  const storeLookup =
    activatedQrStoreLookup?.store
      ? {
          data: {
            id: activatedQrStoreLookup.store.id,
            market_name: activatedQrStoreLookup.store.market_name,
            store_name: activatedQrStoreLookup.store.store_name,
          },
          error: null,
        }
      : body.storeId && isUuid(body.storeId)
        ? await resolveStore(supabase, { storeId: body.storeId })
        : await resolveStore(supabase, {
            marketName: body.marketName!.trim(),
            storeName: body.storeName!.trim(),
          });

  if (storeLookup.error || !storeLookup.data) {
    return errorResponse("Store not found", 404, {
      code: "STORE_NOT_FOUND",
    });
  }

  const expectedPrefix = `stores/${storeLookup.data.id}/`;

  if (!body.filePath!.trim().startsWith(expectedPrefix)) {
    return errorResponse("File does not belong to the resolved store", 400, {
      code: "FILE_STORE_MISMATCH",
      details: {
        expectedPrefix,
      },
    });
  }

  try {
    const review = await reviewPhotoAsset({
      supabase,
      bucket: body.bucket!.trim(),
      filePath: body.filePath!.trim(),
      assetType: body.assetType!,
      category,
      shotOrder:
        typeof body.shotOrder === "number" ? Math.trunc(body.shotOrder) : null,
    });
    const guideShot =
      typeof body.shotOrder === "number"
        ? findPhotoGuideShot(category, Math.trunc(body.shotOrder))
        : null;

    return successResponse(
      {
        asset: {
          bucket: body.bucket!.trim(),
          filePath: body.filePath!.trim(),
          assetType: body.assetType,
        },
        guideShot: guideShot
          ? {
              order: guideShot.order,
              title: guideShot.title,
              description: guideShot.description,
              emphasis: guideShot.emphasis ?? null,
            }
          : null,
        review,
      },
      "Photo reviewed",
    );
  } catch (error) {
    return errorResponse("Failed to review photo", 500, {
      code: "PHOTO_REVIEW_FAILED",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
