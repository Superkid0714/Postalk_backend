import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import { getAdminApiKey } from "@/lib/env";
import {
  buildPromoPrompt,
  generatePromoImage,
  normalizeStoreRelation,
  normalizeSubmissionRelation,
} from "@/lib/ai/generation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function isAuthorized(request: NextRequest) {
  const adminApiKey = getAdminApiKey();

  if (!adminApiKey) {
    return false;
  }

  return request.headers.get("x-admin-key") === adminApiKey;
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isAuthorized(request)) {
    return errorResponse("Unauthorized", 401, {
      code: "UNAUTHORIZED",
    });
  }

  const { id } = await context.params;

  if (!isUuid(id)) {
    return errorResponse("Invalid generation job id", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const supabase = getSupabaseAdminClient();

  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .select(`
      id,
      submission_id,
      store_id,
      status,
      style_preset,
      prompt_text,
      model_name,
      image_size,
      quality,
      submissions (
        id,
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
      )
    `)
    .eq("id", id)
    .single();

  if (jobError || !job) {
    return errorResponse("Generation job not found", 404, {
      code: "GENERATION_JOB_NOT_FOUND",
    });
  }

  if (job.status === "processing") {
    return errorResponse("Generation job is already processing", 409, {
      code: "GENERATION_JOB_ALREADY_PROCESSING",
    });
  }

  if (job.status === "completed") {
    return successResponse(
      {
        jobId: job.id,
        status: job.status,
      },
      "Generation job already completed",
    );
  }

  const normalizedSubmission = normalizeSubmissionRelation(job.submissions);

  if (!normalizedSubmission) {
    return errorResponse("Generation job submission not found", 404, {
      code: "SUBMISSION_NOT_FOUND",
    });
  }

  const promptText =
    job.prompt_text ??
    buildPromoPrompt(
      {
        ...normalizedSubmission,
        stores: normalizeStoreRelation(normalizedSubmission.stores),
      },
      job.style_preset,
    );

  const { error: processingUpdateError } = await supabase
    .from("generation_jobs")
    .update({
      status: "processing",
      started_at: new Date().toISOString(),
      failure_reason: null,
      prompt_text: promptText,
    })
    .eq("id", job.id);

  if (processingUpdateError) {
    return errorResponse("Failed to start generation job", 500, {
      code: "GENERATION_JOB_START_FAILED",
      details: processingUpdateError.message,
    });
  }

  try {
    const result = await generatePromoImage({
      prompt: promptText,
      model: job.model_name,
      size: job.image_size,
      quality: job.quality,
    });

    const filePath = `${job.store_id}/${job.submission_id}/generated/${job.id}.png`;

    const { error: uploadError } = await supabase.storage
      .from("uploads")
      .upload(filePath, result.bytes, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data: asset, error: assetInsertError } = await supabase
      .from("submission_assets")
      .insert({
        submission_id: job.submission_id,
        asset_type: "generated_image",
        storage_bucket: "uploads",
        file_path: filePath,
        file_name: `${job.id}.png`,
        mime_type: "image/png",
        file_size: result.bytes.byteLength,
      })
      .select("id")
      .single();

    if (assetInsertError || !asset) {
      throw new Error(assetInsertError?.message ?? "Asset insert failed");
    }

    const { error: completeUpdateError } = await supabase
      .from("generation_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        failure_reason: null,
        result_asset_id: asset.id,
        result_storage_bucket: "uploads",
        result_file_path: filePath,
        result_payload: {
          revisedPrompt: result.revisedPrompt,
        },
      })
      .eq("id", job.id);

    if (completeUpdateError) {
      throw new Error(completeUpdateError.message);
    }

    return successResponse(
      {
        jobId: job.id,
        status: "completed",
        resultAssetId: asset.id,
        filePath,
      },
      "Generation job processed",
    );
  } catch (error) {
    const failureReason =
      error instanceof Error ? error.message : "Unknown generation error";

    await supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        failure_reason: failureReason,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return errorResponse("Generation job failed", 500, {
      code: "GENERATION_JOB_PROCESS_FAILED",
      details: failureReason,
    });
  }
}
