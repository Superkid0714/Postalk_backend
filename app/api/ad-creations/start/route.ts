import { after } from "next/server";
import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  buildSubmissionPrompt,
  hasRequiredPhotoAssets,
  mergeSubmissionWorkflowMetadata,
  validateSubmissionStylePreset,
  type AdType,
} from "@/lib/ad-creation";
import { type GenerationStylePreset } from "@/lib/ai/generation";
import { processGenerationJobById } from "@/lib/generation/process-job";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

type StartAdCreationBody = {
  submissionId?: string;
  adType?: AdType;
  stylePreset?: GenerationStylePreset;
  mockMode?: boolean;
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

export async function POST(request: NextRequest) {
  let body: StartAdCreationBody;

  try {
    body = (await request.json()) as StartAdCreationBody;
  } catch {
    return errorResponse("Invalid JSON body", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  if (!body.submissionId || !isUuid(body.submissionId)) {
    return errorResponse("submissionId must be a valid UUID", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "submissionId", reason: "Invalid UUID" }],
    });
  }

  const adType = body.adType ?? "photo";

  if (adType !== "photo") {
    return errorResponse("Only photo ad creation is supported right now", 400, {
      code: "UNSUPPORTED_AD_TYPE",
    });
  }

  if (body.stylePreset && !ALLOWED_STYLE_PRESETS.includes(body.stylePreset)) {
    return errorResponse("Invalid stylePreset", 400, {
      code: "VALIDATION_ERROR",
      details: [{ field: "stylePreset", reason: "Unsupported style preset" }],
    });
  }

  const stylePreset = body.stylePreset ?? "menu_highlight";
  const mockMode = body.mockMode === true;
  const supabase = getSupabaseAdminClient();

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
      ai_metadata,
      stores (
        market_name,
        store_name,
        owner_name
      ),
      submission_assets (
        asset_type,
        storage_bucket,
        file_path,
        sort_order
      )
    `)
    .eq("id", body.submissionId)
    .single();

  if (submissionError || !submission) {
    return errorResponse("Submission not found", 404, {
      code: "SUBMISSION_NOT_FOUND",
    });
  }

  if (!hasRequiredPhotoAssets(submission.submission_assets)) {
    return errorResponse("menu_board and food_photo assets are required", 400, {
      code: "MISSING_REQUIRED_ASSETS",
    });
  }

  const stylePresetValidation = validateSubmissionStylePreset(
    submission,
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
        submissionId: submission.id,
        status: existingJob.status,
        reused: true,
      },
      "Existing generation job reused",
    );
  }

  const promptText = buildSubmissionPrompt(submission, stylePreset);
  const requestedAt = new Date().toISOString();

  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .insert({
      submission_id: submission.id,
      store_id: submission.store_id,
      status: "queued",
      style_preset: stylePreset,
      prompt_text: promptText,
      model_name: mockMode ? "gpt-image-mock" : "gpt-image-2",
      image_size: resolveImageSize(stylePreset),
      quality: "medium",
      request_payload: {
        source: "ad-creation-start",
        adType,
        stylePreset,
        mockMode,
      },
    })
    .select("id, status, created_at")
    .single();

  if (jobError || !job) {
    return errorResponse("Failed to create generation job", 500, {
      code: "GENERATION_JOB_CREATE_FAILED",
      details: jobError?.message,
    });
  }

  const { error: submissionUpdateError } = await supabase
    .from("submissions")
    .update({
      ai_metadata: mergeSubmissionWorkflowMetadata(submission.ai_metadata, {
        adType,
        publishRequestStatus: "generating",
        currentJobId: job.id,
        generationRequestedAt: requestedAt,
        lastFailureReason: null,
      }),
    })
    .eq("id", submission.id);

  if (submissionUpdateError) {
    return errorResponse("Failed to update submission workflow", 500, {
      code: "SUBMISSION_UPDATE_FAILED",
      details: submissionUpdateError.message,
    });
  }

  after(async () => {
    try {
      await processGenerationJobById(job.id);
    } catch (error) {
      console.error("Ad creation background processing failed", {
        jobId: job.id,
        error,
      });
    }
  });

  return successResponse(
    {
      jobId: job.id,
      submissionId: submission.id,
      status: job.status,
      adType,
      stylePreset,
      mockMode,
      createdAt: job.created_at,
    },
    "Ad creation started",
    201,
  );
}
