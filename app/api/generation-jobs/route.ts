import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  buildPromoPrompt,
  normalizeStoreRelation,
  validateStylePresetForSubmission,
  type GenerationStylePreset,
} from "@/lib/ai/generation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveStore } from "@/lib/stores";
import { isUuid } from "@/lib/validation";

type CreateGenerationJobBody = {
  submissionId?: string;
  storeId?: string;
  marketName?: string;
  storeName?: string;
  stylePreset?: GenerationStylePreset;
};

const ALLOWED_STYLE_PRESETS: GenerationStylePreset[] = [
  "menu_highlight",
  "clean_poster",
  "market_story",
  "food_card_news",
];

function resolveImageSize(stylePreset: GenerationStylePreset) {
  return stylePreset === "food_card_news" ? "1024x1536" : "1536x1024";
}

function validateBody(body: CreateGenerationJobBody) {
  const details: Array<{ field: string; reason: string }> = [];

  if (!body.submissionId?.trim()) {
    details.push({
      field: "submissionId",
      reason: "submissionId is required",
    });
  } else if (!isUuid(body.submissionId)) {
    details.push({
      field: "submissionId",
      reason: "submissionId must be a valid UUID",
    });
  }

  if (body.storeId && !isUuid(body.storeId)) {
    details.push({
      field: "storeId",
      reason: "storeId must be a valid UUID",
    });
  }

  if (
    body.stylePreset &&
    !ALLOWED_STYLE_PRESETS.includes(body.stylePreset)
  ) {
    details.push({
      field: "stylePreset",
      reason: `stylePreset must be one of ${ALLOWED_STYLE_PRESETS.join(", ")}`,
    });
  }

  return details;
}

export async function POST(request: NextRequest) {
  let body: CreateGenerationJobBody;

  try {
    body = (await request.json()) as CreateGenerationJobBody;
  } catch {
    return errorResponse("Invalid JSON body", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const validationErrors = validateBody(body);

  if (validationErrors.length > 0) {
    return errorResponse("Invalid request body", 400, {
      code: "VALIDATION_ERROR",
      details: validationErrors,
    });
  }

  const supabase = getSupabaseAdminClient();
  const stylePreset = body.stylePreset ?? "menu_highlight";

  const { data: submission, error: submissionError } = await supabase
    .from("submissions")
    .select(`
      id,
      store_id,
      title,
      caption,
      store_type,
      target_menu_name,
      price_text,
      appeal_point,
      extra_message,
      stores (
        market_name,
        store_name,
        owner_name
      )
    `)
    .eq("id", body.submissionId!)
    .single();

  if (submissionError || !submission) {
    return errorResponse("Submission not found", 404, {
      code: "SUBMISSION_NOT_FOUND",
    });
  }

  if (body.storeId || (body.marketName && body.storeName)) {
    const storeLookup =
      body.storeId && isUuid(body.storeId)
        ? await resolveStore(supabase, { storeId: body.storeId })
        : await resolveStore(supabase, {
            marketName: body.marketName!.trim(),
            storeName: body.storeName!.trim(),
          });

    if (
      storeLookup.error ||
      !storeLookup.data ||
      storeLookup.data.id !== submission.store_id
    ) {
      return errorResponse("Store does not match submission", 400, {
        code: "STORE_SUBMISSION_MISMATCH",
      });
    }
  }

  const promptText = buildPromoPrompt(
    {
      ...submission,
      stores: normalizeStoreRelation(submission.stores),
    },
    stylePreset,
  );
  const stylePresetValidation = validateStylePresetForSubmission(
    {
      ...submission,
      stores: normalizeStoreRelation(submission.stores),
    },
    stylePreset,
  );

  if (!stylePresetValidation.ok) {
    return errorResponse(stylePresetValidation.reason, 400, {
      code: "UNSUPPORTED_STYLE_PRESET_FOR_SUBMISSION",
    });
  }

  const { data: existingJob } = await supabase
    .from("generation_jobs")
    .select("id, status")
    .eq("submission_id", submission.id)
    .in("status", ["queued", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingJob) {
    return successResponse(
      {
        jobId: existingJob.id,
        status: existingJob.status,
        reused: true,
      },
      "Existing generation job reused",
      200,
    );
  }

  const { data: job, error: insertError } = await supabase
    .from("generation_jobs")
    .insert({
      submission_id: submission.id,
      store_id: submission.store_id,
      status: "queued",
      style_preset: stylePreset,
      prompt_text: promptText,
      model_name: "gpt-image-2",
      image_size: resolveImageSize(stylePreset),
      quality: "medium",
      request_payload: {
        stylePreset,
      },
    })
    .select("id, status, created_at")
    .single();

  if (insertError || !job) {
    return errorResponse("Failed to create generation job", 500, {
      code: "GENERATION_JOB_CREATE_FAILED",
      details: insertError?.message,
    });
  }

  return successResponse(
    {
      jobId: job.id,
      submissionId: submission.id,
      status: job.status,
      stylePreset,
      createdAt: job.created_at,
    },
    "Generation job created",
    201,
  );
}
