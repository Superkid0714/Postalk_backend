import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveStore } from "@/lib/stores";
import { isUuid } from "@/lib/validation";

type SubmissionAssetInput = {
  assetType?:
    | "menu_board"
    | "food_photo"
    | "generated_image"
    | "generated_video"
    | "video_thumbnail";
  bucket?: string;
  filePath?: string;
  fileName?: string;
  mimeType?: string | null;
  fileSize?: number | null;
  sortOrder?: number | null;
};

type CreateSubmissionBody = {
  storeId?: string;
  marketName?: string;
  storeName?: string;
  submitterName?: string;
  submitterAffiliation?: string;
  qrPayload?: string;
  storeType?: string;
  targetMenuName?: string;
  priceText?: string;
  appealPoint?: string;
  targetCustomer?: string;
  peakSalesTime?: string;
  popularMenuNotes?: string;
  extraMessage?: string;
  title?: string;
  caption?: string | null;
  hashtags?: string[];
  transcript?: string;
  aiMetadata?: Record<string, unknown>;
  assets?: SubmissionAssetInput[];
};

function validateSubmissionBody(body: CreateSubmissionBody) {
  const details: Array<{ field: string; reason: string }> = [];

  const hasStoreId = typeof body.storeId === "string" && body.storeId.trim();
  const hasStoreNames =
    typeof body.marketName === "string" &&
    body.marketName.trim() &&
    typeof body.storeName === "string" &&
    body.storeName.trim();

  if (!hasStoreId && !hasStoreNames) {
    details.push({
      field: "store",
      reason: "Provide storeId or both marketName and storeName",
    });
  }

  if (hasStoreId && !isUuid(body.storeId!)) {
    details.push({
      field: "storeId",
      reason: "storeId must be a valid UUID",
    });
  }

  if (!body.submitterName?.trim()) {
    details.push({
      field: "submitterName",
      reason: "submitterName is required",
    });
  }

  if (!body.storeType?.trim()) {
    details.push({
      field: "storeType",
      reason: "storeType is required",
    });
  }

  if (!body.targetMenuName?.trim()) {
    details.push({
      field: "targetMenuName",
      reason: "targetMenuName is required",
    });
  }

  if (!body.appealPoint?.trim()) {
    details.push({
      field: "appealPoint",
      reason: "appealPoint is required",
    });
  }

  if (body.hashtags && !Array.isArray(body.hashtags)) {
    details.push({
      field: "hashtags",
      reason: "hashtags must be an array of strings",
    });
  }

  if (body.assets && !Array.isArray(body.assets)) {
    details.push({
      field: "assets",
      reason: "assets must be an array",
    });
  }

  if (!body.assets || body.assets.length === 0) {
    details.push({
      field: "assets",
      reason: "At least one menu_board and one food_photo asset are required",
    });
  } else {
    const hasMenuBoard = body.assets.some(
      (asset) => asset.assetType === "menu_board",
    );
    const hasFoodPhoto = body.assets.some(
      (asset) => asset.assetType === "food_photo",
    );

    if (!hasMenuBoard) {
      details.push({
        field: "assets",
        reason: "At least one menu_board asset is required",
      });
    }

    if (!hasFoodPhoto) {
      details.push({
        field: "assets",
        reason: "At least one food_photo asset is required",
      });
    }
  }

  return details;
}

function buildSubmissionAiMetadata(body: CreateSubmissionBody) {
  const base =
    body.aiMetadata && typeof body.aiMetadata === "object" ? body.aiMetadata : {};

  return {
    ...base,
    merchantInsights: {
      targetCustomer: body.targetCustomer?.trim() || null,
      peakSalesTime: body.peakSalesTime?.trim() || null,
      popularMenuNotes: body.popularMenuNotes?.trim() || null,
    },
  };
}

export async function POST(request: NextRequest) {
  let body: CreateSubmissionBody;

  try {
    body = (await request.json()) as CreateSubmissionBody;
  } catch {
    return errorResponse("Invalid JSON body", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const validationErrors = validateSubmissionBody(body);

  if (validationErrors.length > 0) {
    return errorResponse("Invalid request body", 400, {
      code: "VALIDATION_ERROR",
      details: validationErrors,
    });
  }

  const supabase = getSupabaseAdminClient();

  const storeLookup =
    body.storeId && isUuid(body.storeId)
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

  const { data: submission, error: submissionError } = await supabase
    .from("submissions")
    .insert({
      store_id: storeLookup.data.id,
      submitter_name: body.submitterName!.trim(),
      submitter_affiliation: body.submitterAffiliation?.trim() || null,
      qr_payload: body.qrPayload?.trim() || null,
      store_type: body.storeType!.trim(),
      target_menu_name: body.targetMenuName!.trim(),
      price_text: body.priceText?.trim() || "",
      appeal_point: body.appealPoint!.trim(),
      extra_message: body.extraMessage?.trim() || null,
      title: body.title?.trim() || null,
      caption: body.caption?.trim() || null,
      hashtags: body.hashtags ?? [],
      transcript: body.transcript?.trim() || null,
      ai_metadata: buildSubmissionAiMetadata(body),
      status: "pending_review",
    })
    .select("id, status, created_at")
    .single();

  if (submissionError || !submission) {
    return errorResponse("Failed to create submission", 500, {
      code: "SUBMISSION_CREATE_FAILED",
      details: submissionError?.message,
    });
  }

  if (body.assets && body.assets.length > 0) {
    const normalizedAssets = body.assets.map((asset, index) => ({
      submission_id: submission.id,
      asset_type: asset.assetType ?? "food_photo",
      storage_bucket: asset.bucket ?? "uploads",
      file_path: asset.filePath ?? "",
      file_name: asset.fileName ?? null,
      mime_type: asset.mimeType ?? null,
      file_size: asset.fileSize ?? null,
      sort_order: asset.sortOrder ?? index,
    }));

    const invalidAssets = normalizedAssets.some((asset) => !asset.file_path);

    if (invalidAssets) {
      await supabase.from("submissions").delete().eq("id", submission.id);

      return errorResponse("Each asset must include filePath", 400, {
        code: "VALIDATION_ERROR",
      });
    }

    const { error: assetInsertError } = await supabase
      .from("submission_assets")
      .insert(normalizedAssets);

    if (assetInsertError) {
      await supabase.from("submissions").delete().eq("id", submission.id);

      return errorResponse("Failed to attach submission assets", 500, {
        code: "SUBMISSION_ASSET_CREATE_FAILED",
        details: assetInsertError.message,
      });
    }
  }

  return successResponse(
    {
      submissionId: submission.id,
      status: submission.status,
      store: {
        id: storeLookup.data.id,
        marketName: storeLookup.data.market_name,
        storeName: storeLookup.data.store_name,
      },
      createdAt: submission.created_at,
    },
    "Submission created",
    201,
  );
}
