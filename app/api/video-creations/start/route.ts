import { readFile } from "node:fs/promises";
import path from "node:path";

import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  startGeminiVideoOperation,
  type VideoAspectRatio,
  type VideoDurationSeconds,
  type VideoResolution,
  type VideoStylePreset,
} from "@/lib/ai/video";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";
import {
  buildSubmissionVideoPrompt,
  buildSubmissionVideoScript,
  mergeSubmissionVideoWorkflowMetadata,
  pickPrimaryVideoImage,
  type VideoSubmissionRow,
} from "@/lib/video-creation";

type StartVideoCreationBody = {
  submissionId?: string;
  stylePreset?: VideoStylePreset;
  aspectRatio?: VideoAspectRatio;
  resolution?: VideoResolution;
  durationSeconds?: VideoDurationSeconds;
  mockMode?: boolean;
};

const ALLOWED_STYLE_PRESETS: VideoStylePreset[] = [
  "market_story",
  "food_closeup",
  "premium",
];

const ALLOWED_ASPECT_RATIOS: VideoAspectRatio[] = ["9:16", "16:9"];
const ALLOWED_RESOLUTIONS: VideoResolution[] = ["720p", "1080p"];
const ALLOWED_DURATIONS: VideoDurationSeconds[] = [4, 6, 8];

function isGenerationJobsMissingError(message: string | null | undefined) {
  return Boolean(
    message &&
      (message.includes("generation_jobs") || message.includes("schema cache")),
  );
}

function isGeneratedVideoAssetConstraintError(
  message: string | null | undefined,
) {
  return Boolean(
    message &&
      (message.includes("submission_assets_asset_type_check") ||
        message.includes("asset_type")),
  );
}

export async function POST(request: NextRequest) {
  let body: StartVideoCreationBody;

  try {
    body = (await request.json()) as StartVideoCreationBody;
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

  if (body.stylePreset && !ALLOWED_STYLE_PRESETS.includes(body.stylePreset)) {
    return errorResponse("Invalid stylePreset", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  if (body.aspectRatio && !ALLOWED_ASPECT_RATIOS.includes(body.aspectRatio)) {
    return errorResponse("Invalid aspectRatio", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  if (body.resolution && !ALLOWED_RESOLUTIONS.includes(body.resolution)) {
    return errorResponse("Invalid resolution", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  if (body.durationSeconds && !ALLOWED_DURATIONS.includes(body.durationSeconds)) {
    return errorResponse("Invalid durationSeconds", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const stylePreset = body.stylePreset ?? "market_story";
  const aspectRatio = body.aspectRatio ?? "9:16";
  const resolution = body.resolution ?? "720p";
  const durationSeconds = body.durationSeconds ?? 8;
  const supabase = getSupabaseAdminClient();

  const { data: submission, error: submissionError } = await supabase
    .from("submissions")
    .select(`
      id,
      store_id,
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
        sort_order,
        mime_type
      )
    `)
    .eq("id", body.submissionId)
    .single<VideoSubmissionRow>();

  if (submissionError || !submission) {
    return errorResponse("Submission not found", 404, {
      code: "SUBMISSION_NOT_FOUND",
    });
  }

  const primaryImage = pickPrimaryVideoImage(submission.submission_assets);

  if (!primaryImage) {
    return errorResponse("A food photo or menu board image is required", 400, {
      code: "MISSING_REQUIRED_ASSETS",
    });
  }

  const { data: existingJob } = await supabase
    .from("generation_jobs")
    .select("id, status, model_name")
    .eq("submission_id", submission.id)
    .in("status", ["queued", "processing"])
    .like("model_name", "veo%")
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
      "Existing video generation job reused",
    );
  }

  const { data: imageData, error: imageDownloadError } = await supabase.storage
    .from(primaryImage.storage_bucket)
    .download(primaryImage.file_path);

  if (imageDownloadError || !imageData) {
    return errorResponse("Failed to load submission image for video generation", 500, {
      code: "SUBMISSION_IMAGE_LOAD_FAILED",
      details: imageDownloadError?.message,
    });
  }

  const imageBytes = Buffer.from(await imageData.arrayBuffer()).toString("base64");
  const promptText = buildSubmissionVideoPrompt(submission, stylePreset);
  const script = buildSubmissionVideoScript(submission, stylePreset);

  if (body.mockMode === true) {
    const createdAt = new Date().toISOString();
    const mockJobId = crypto.randomUUID();
    const { data: job, error: jobError } = await supabase
      .from("generation_jobs")
      .insert({
        submission_id: submission.id,
        store_id: submission.store_id,
        status: "processing",
        style_preset: stylePreset,
        prompt_text: promptText,
        model_name: "veo-mock",
        image_size: aspectRatio,
        quality: resolution,
        started_at: createdAt,
        request_payload: {
          generationType: "video",
          provider: "mock",
          mockMode: true,
          durationSeconds,
          aspectRatio,
          resolution,
          stylePreset,
          sourceAssetPath: primaryImage.file_path,
        },
        result_payload: {
          script,
        },
      })
      .select("id, status, created_at")
      .single();
    const effectiveJobId = job?.id ?? mockJobId;
    const effectiveCreatedAt = job?.created_at ?? createdAt;

    if (jobError && !isGenerationJobsMissingError(jobError.message)) {
      return errorResponse("Failed to create mock video generation job", 500, {
        code: "VIDEO_JOB_CREATE_FAILED",
        details: jobError.message,
      });
    }

    try {
      const sampleVideoPath = path.join(
        process.cwd(),
        "public",
        "mock",
        "postalk-sample-video.mp4",
      );
      const sampleVideoBytes = await readFile(sampleVideoPath);
      const filePath = `${submission.store_id}/${submission.id}/generated/${effectiveJobId}.mp4`;

      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(filePath, sampleVideoBytes, {
          contentType: "video/mp4",
          upsert: true,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data: asset, error: assetError } = await supabase
        .from("submission_assets")
        .insert({
          submission_id: submission.id,
          asset_type: "generated_video",
          storage_bucket: "uploads",
          file_path: filePath,
          file_name: `${effectiveJobId}.mp4`,
          mime_type: "video/mp4",
          file_size: sampleVideoBytes.byteLength,
        })
        .select("id")
        .single();

      let resultAssetId: string | null = asset?.id ?? null;

      if (assetError && !isGeneratedVideoAssetConstraintError(assetError.message)) {
        throw new Error(assetError.message);
      }

      const completedAt = new Date().toISOString();

      if (job?.id) {
        await supabase
          .from("generation_jobs")
          .update({
            status: "completed",
            completed_at: completedAt,
            failure_reason: null,
            result_asset_id: resultAssetId,
            result_storage_bucket: "uploads",
            result_file_path: filePath,
            result_payload: {
              script,
              provider: "mock",
              sample: true,
            },
          })
          .eq("id", job.id);
      }

      await supabase
        .from("submissions")
        .update({
          ai_metadata: mergeSubmissionVideoWorkflowMetadata(submission.ai_metadata, {
            currentJobId: effectiveJobId,
            lastCompletedJobId: effectiveJobId,
            providerOperationName: "mock-operation",
            status: "generated",
            durationSeconds,
            aspectRatio,
            resolution,
            stylePreset,
            generatedAt: completedAt,
            lastFailureReason: null,
            resultStorageBucket: "uploads",
            resultFilePath: filePath,
            modelName: "veo-mock",
            mockMode: true,
            script,
          }),
        })
        .eq("id", submission.id);

      return successResponse(
        {
          jobId: effectiveJobId,
          submissionId: submission.id,
          status: "completed",
          providerOperationName: "mock-operation",
          durationSeconds,
          aspectRatio,
          resolution,
          stylePreset,
          mockMode: true,
          createdAt: effectiveCreatedAt,
        },
        "Mock video creation completed",
        201,
      );
    } catch (error) {
      const failureReason =
        error instanceof Error ? error.message : "Failed to create mock video";

      if (job?.id) {
        await supabase
          .from("generation_jobs")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            failure_reason: failureReason,
          })
          .eq("id", job.id);
      }

      return errorResponse("Failed to create mock video generation", 500, {
        code: "MOCK_VIDEO_GENERATION_FAILED",
        details: failureReason,
      });
    }
  }

  let operationName: string;

  try {
    const operation = await startGeminiVideoOperation({
      prompt: promptText,
      image: {
        mimeType: primaryImage.mime_type ?? "image/png",
        bytesBase64: imageBytes,
      },
      aspectRatio,
      resolution,
      durationSeconds,
    });

    operationName = operation.name;
  } catch (error) {
    return errorResponse("Failed to start Gemini video generation", 500, {
      code: "VIDEO_GENERATION_START_FAILED",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }

  const createdAt = new Date().toISOString();
  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .insert({
      submission_id: submission.id,
      store_id: submission.store_id,
      status: "processing",
      style_preset: stylePreset,
      prompt_text: promptText,
      model_name: "veo-3.1-generate-preview",
      image_size: aspectRatio,
      quality: resolution,
      started_at: createdAt,
      request_payload: {
        generationType: "video",
        provider: "gemini-veo",
        providerOperationName: operationName,
        durationSeconds,
        aspectRatio,
        resolution,
        stylePreset,
        sourceAssetPath: primaryImage.file_path,
      },
      result_payload: {
        script,
      },
    })
    .select("id, status, created_at")
    .single();

  if (jobError || !job) {
    return errorResponse("Failed to create video generation job", 500, {
      code: "VIDEO_JOB_CREATE_FAILED",
      details: jobError?.message,
    });
  }

  const { error: submissionUpdateError } = await supabase
    .from("submissions")
    .update({
      ai_metadata: mergeSubmissionVideoWorkflowMetadata(submission.ai_metadata, {
        currentJobId: job.id,
        providerOperationName: operationName,
        status: "generating",
        durationSeconds,
        aspectRatio,
        resolution,
        stylePreset,
        lastFailureReason: null,
        script,
      }),
    })
    .eq("id", submission.id);

  if (submissionUpdateError) {
    return errorResponse("Failed to update submission video workflow", 500, {
      code: "SUBMISSION_UPDATE_FAILED",
      details: submissionUpdateError.message,
    });
  }

  return successResponse(
    {
      jobId: job.id,
      submissionId: submission.id,
      status: job.status,
      providerOperationName: operationName,
      durationSeconds,
      aspectRatio,
      resolution,
      stylePreset,
      createdAt: job.created_at,
    },
    "Video creation started",
    201,
  );
}
