import { after } from "next/server";
import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  buildSubmissionPrompt,
  getSubmissionWorkflowMetadata,
  hasRequiredPhotoAssets,
  mergeSubmissionWorkflowMetadata,
  validateSubmissionStylePreset,
} from "@/lib/ad-creation";
import { type GenerationStylePreset } from "@/lib/ai/generation";
import { processGenerationJobById } from "@/lib/generation/process-job";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

type RegenerateBody = {
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

export async function POST(request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;

  if (!isUuid(jobId)) {
    return errorResponse("Invalid generation job id", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  let body: RegenerateBody = {};

  try {
    body = (await request.json()) as RegenerateBody;
  } catch {
    body = {};
  }

  if (body.stylePreset && !ALLOWED_STYLE_PRESETS.includes(body.stylePreset)) {
    return errorResponse("Invalid stylePreset", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const supabase = getSupabaseAdminClient();

  const { data: existingJob, error: existingJobError } = await supabase
    .from("generation_jobs")
    .select(`
      id,
      submission_id,
      store_id,
      style_preset,
      submissions (
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
      )
    `)
    .eq("id", jobId)
    .single();

  if (existingJobError || !existingJob) {
    return errorResponse("Ad creation job not found", 404, {
      code: "GENERATION_JOB_NOT_FOUND",
    });
  }

  const submission = Array.isArray(existingJob.submissions)
    ? existingJob.submissions[0]
    : existingJob.submissions;

  if (!submission) {
    return errorResponse("Submission not found", 404, {
      code: "SUBMISSION_NOT_FOUND",
    });
  }

  if (!hasRequiredPhotoAssets(submission.submission_assets)) {
    return errorResponse("menu_board and food_photo assets are required", 400, {
      code: "MISSING_REQUIRED_ASSETS",
    });
  }

  const stylePreset = body.stylePreset ?? existingJob.style_preset;
  const stylePresetValidation = validateSubmissionStylePreset(
    submission,
    stylePreset,
  );

  if (!stylePresetValidation.ok) {
    return errorResponse(stylePresetValidation.reason, 400, {
      code: "UNSUPPORTED_STYLE_PRESET_FOR_SUBMISSION",
    });
  }

  const promptText = buildSubmissionPrompt(submission, stylePreset);
  const workflow = getSubmissionWorkflowMetadata(submission.ai_metadata);
  const regenerateCount = (workflow.regenerateCount ?? 0) + 1;
  const requestedAt = new Date().toISOString();

  const { data: newJob, error: newJobError } = await supabase
    .from("generation_jobs")
    .insert({
      submission_id: submission.id,
      store_id: existingJob.store_id,
      status: "queued",
      style_preset: stylePreset,
      prompt_text: promptText,
      model_name: body.mockMode === true ? "gpt-image-mock" : "gpt-image-2",
      image_size: resolveImageSize(stylePreset),
      quality: "medium",
      request_payload: {
        source: "ad-creation-regenerate",
        previousJobId: existingJob.id,
        regenerateCount,
        mockMode: body.mockMode === true,
      },
    })
    .select("id, status, created_at")
    .single();

  if (newJobError || !newJob) {
    return errorResponse("Failed to create regeneration job", 500, {
      code: "GENERATION_JOB_CREATE_FAILED",
      details: newJobError?.message,
    });
  }

  const { error: submissionUpdateError } = await supabase
    .from("submissions")
    .update({
      ai_metadata: mergeSubmissionWorkflowMetadata(submission.ai_metadata, {
        adType: workflow.adType ?? "photo",
        publishRequestStatus: "generating",
        currentJobId: newJob.id,
        generationRequestedAt: requestedAt,
        regenerateCount,
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
      await processGenerationJobById(newJob.id);
    } catch (error) {
      console.error("Ad regeneration background processing failed", {
        jobId: newJob.id,
        error,
      });
    }
  });

  return successResponse(
    {
      previousJobId: existingJob.id,
      jobId: newJob.id,
      submissionId: submission.id,
      status: newJob.status,
      stylePreset,
      mockMode: body.mockMode === true,
      regenerateCount,
      createdAt: newJob.created_at,
    },
    "Ad regeneration started",
    201,
  );
}
