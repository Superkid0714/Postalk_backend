import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { sanitizeFileName } from "@/lib/files";
import { resolveActivatedStoreFromQrToken } from "@/lib/merchant-qr";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveStore } from "@/lib/stores";
import { isUuid } from "@/lib/validation";

const MAX_FILE_SIZE_BY_TYPE = {
  menu_board: 10 * 1024 * 1024,
  food_photo: 10 * 1024 * 1024,
} as const;

const MIME_TYPES_BY_ASSET_TYPE: Record<AssetType, string[]> = {
  menu_board: ["image/jpeg", "image/png", "image/webp"],
  food_photo: ["image/jpeg", "image/png", "image/webp"],
};

type AssetType = keyof typeof MAX_FILE_SIZE_BY_TYPE;

function isAssetType(value: string): value is AssetType {
  return value === "menu_board" || value === "food_photo";
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();

  const assetTypeValue = formData.get("assetType");
  const qrTokenValue = formData.get("qrToken");
  const storeIdValue = formData.get("storeId");
  const marketNameValue = formData.get("marketName");
  const storeNameValue = formData.get("storeName");
  const fileValue = formData.get("file");

  if (typeof assetTypeValue !== "string" || !isAssetType(assetTypeValue)) {
    return errorResponse("Invalid assetType", 400, {
      code: "VALIDATION_ERROR",
      details: [
        {
          field: "assetType",
          reason: "assetType must be 'menu_board' or 'food_photo'",
        },
      ],
    });
  }

  if (!(fileValue instanceof File)) {
    return errorResponse("Missing file", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "file", reason: "file is required" }],
    });
  }

  const allowedMimeTypes = MIME_TYPES_BY_ASSET_TYPE[assetTypeValue];

  if (!allowedMimeTypes.includes(fileValue.type)) {
    return errorResponse("Unsupported media type", 415, {
      code: "UNSUPPORTED_MEDIA_TYPE",
      details: [
        {
          field: "file",
          reason: `Allowed types: ${allowedMimeTypes.join(", ")}`,
        },
      ],
    });
  }

  const maxFileSize = MAX_FILE_SIZE_BY_TYPE[assetTypeValue];

  if (fileValue.size > maxFileSize) {
    return errorResponse("File size exceeds limit", 413, {
      code: "PAYLOAD_TOO_LARGE",
      details: [
        {
          field: "file",
          reason: `Max size is ${maxFileSize} bytes`,
        },
      ],
    });
  }

  const supabase = getSupabaseAdminClient();

  const activatedQrStoreLookup =
    typeof qrTokenValue === "string" && qrTokenValue.trim()
      ? await resolveActivatedStoreFromQrToken(supabase, qrTokenValue.trim())
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
      :
    typeof storeIdValue === "string" && isUuid(storeIdValue)
      ? await resolveStore(supabase, { storeId: storeIdValue })
      : typeof marketNameValue === "string" &&
          typeof storeNameValue === "string" &&
          marketNameValue.trim() &&
          storeNameValue.trim()
        ? await resolveStore(supabase, {
            marketName: marketNameValue.trim(),
            storeName: storeNameValue.trim(),
          })
        : null;

  if (!storeLookup) {
    return errorResponse("Store lookup information is required", 400, {
      code: "VALIDATION_ERROR",
      details: [
        {
          field: "store",
          reason: "Provide qrToken, storeId, or both marketName and storeName",
        },
      ],
    });
  }

  if (storeLookup.error || !storeLookup.data) {
    return errorResponse("Store not found", 404, {
      code: "STORE_NOT_FOUND",
    });
  }

  const assetId = randomUUID();
  const safeFileName = sanitizeFileName(fileValue.name);
  const filePath = `stores/${storeLookup.data.id}/${assetTypeValue}/${assetId}/${safeFileName}`;
  const fileBuffer = Buffer.from(await fileValue.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from("uploads")
    .upload(filePath, fileBuffer, {
      contentType: fileValue.type,
      upsert: false,
    });

  if (uploadError) {
    return errorResponse("Failed to upload file", 500, {
      code: "UPLOAD_FAILED",
      details: uploadError.message,
    });
  }

  return successResponse(
    {
      assetId,
      assetType: assetTypeValue,
      bucket: "uploads",
      filePath,
      fileName: safeFileName,
      mimeType: fileValue.type,
      fileSize: fileValue.size,
      store: {
        id: storeLookup.data.id,
        marketName: storeLookup.data.market_name,
        storeName: storeLookup.data.store_name,
      },
    },
    "File uploaded",
    201,
  );
}
