import { renderQuoteVideo } from "@/lib/ai/quote-video";
import {
  downloadGeminiVideoFile,
  extractGeneratedVideoFile,
  getGeminiVideoOperation,
} from "@/lib/ai/video";
import ffmpegStatic from "ffmpeg-static";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getSubmissionVideoWorkflowMetadata,
  mergeSubmissionVideoWorkflowMetadata,
} from "@/lib/video-creation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

async function extractVideoThumbnailBytes(videoBytes: Uint8Array) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "postalk-video-thumb-"));
  const inputPath = path.join(tempDir, "input.mp4");
  const outputPath = path.join(tempDir, "thumb.jpg");

  try {
    await fs.writeFile(inputPath, videoBytes);

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn(ffmpegStatic ?? "ffmpeg", [
        "-y",
        "-ss",
        "0.1",
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        outputPath,
      ]);

      let stderr = "";

      ffmpeg.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      ffmpeg.on("error", (error) => {
        reject(error);
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      });
    });

    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function saveGeneratedVideoThumbnail(params: {
  submissionId: string;
  jobId: string;
  filePath: string;
  videoBytes: Uint8Array;
}) {
  const supabase = getSupabaseAdminClient();
  const thumbnailBytes = await extractVideoThumbnailBytes(params.videoBytes);
  const thumbnailPath = params.filePath.replace(/\.mp4$/i, ".jpg");

  const { error: uploadError } = await supabase.storage
    .from("uploads")
    .upload(thumbnailPath, thumbnailBytes, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data: asset, error: assetError } = await supabase
    .from("submission_assets")
    .insert({
      submission_id: params.submissionId,
      asset_type: "video_thumbnail",
      storage_bucket: "uploads",
      file_path: thumbnailPath,
      file_name: `${params.jobId}.jpg`,
      mime_type: "image/jpeg",
      file_size: thumbnailBytes.byteLength,
      sort_order: 0,
    })
    .select("id")
    .single();

  if (assetError || !asset) {
    throw new Error(assetError?.message ?? "Failed to save video thumbnail asset");
  }

  return {
    assetId: asset.id,
    filePath: thumbnailPath,
  };
}

export async function processVideoJobById(jobId: string) {
  const supabase = getSupabaseAdminClient();

  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .select(`
      id,
      submission_id,
      store_id,
      status,
      prompt_text,
      model_name,
      failure_reason,
      result_file_path,
      request_payload,
      result_payload,
      submissions (
        id,
        ai_metadata
      )
    `)
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    throw new Error("Video generation job not found");
  }

  const submission = Array.isArray(job.submissions)
    ? job.submissions[0]
    : job.submissions;

  if (!submission) {
    throw new Error("Submission not found");
  }

  const requestPayload =
    typeof job.request_payload === "object" && job.request_payload !== null
      ? (job.request_payload as Record<string, unknown>)
      : {};
  const provider =
    typeof requestPayload.provider === "string"
      ? requestPayload.provider
      : "gemini-veo";
  const providerOperationName =
    typeof requestPayload.providerOperationName === "string"
      ? requestPayload.providerOperationName
      : null;

  if (provider === "render-quote-video") {
    if (job.status === "completed") {
      return {
        jobId: job.id,
        status: "completed" as const,
        providerOperationName: null,
        resultAssetId: null,
        resultFilePath: job.result_file_path ?? null,
        completed: true,
      };
    }

    if (job.status === "failed") {
      throw new Error(job.failure_reason ?? "Quote video generation failed");
    }

    const sourceVideos = Array.isArray(requestPayload.sourceVideos)
      ? requestPayload.sourceVideos
      : [];
    const captionMarkdown =
      typeof requestPayload.captionMarkdown === "string"
        ? requestPayload.captionMarkdown
        : "";

    if (sourceVideos.length === 0) {
      throw new Error("Source videos are missing");
    }

    if (!captionMarkdown.trim()) {
      throw new Error("captionMarkdown is missing");
    }

    const signedVideoUrls = await Promise.all(
      sourceVideos.map(async (item) => {
        if (
          !item ||
          typeof item !== "object" ||
          Array.isArray(item) ||
          typeof item.storageBucket !== "string" ||
          typeof item.filePath !== "string"
        ) {
          throw new Error("Invalid source video payload");
        }

        const { data, error } = await supabase.storage
          .from(item.storageBucket)
          .createSignedUrl(item.filePath, 60 * 60);

        if (error || !data?.signedUrl) {
          throw new Error(error?.message ?? "Failed to sign source video");
        }

        return data.signedUrl;
      }),
    );

    try {
      await supabase
        .from("generation_jobs")
        .update({
          status: "processing",
          started_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      const bytes = await renderQuoteVideo({
        videoUrls: signedVideoUrls,
        captionMarkdown,
      });
      const filePath = `${job.store_id}/${job.submission_id}/generated/${job.id}.mp4`;

      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(filePath, bytes, {
          contentType: "video/mp4",
          upsert: true,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data: asset, error: assetError } = await supabase
        .from("submission_assets")
        .insert({
          submission_id: job.submission_id,
          asset_type: "generated_video",
          storage_bucket: "uploads",
          file_path: filePath,
          file_name: `${job.id}.mp4`,
          mime_type: "video/mp4",
          file_size: bytes.byteLength,
        })
        .select("id")
        .single();

      if (assetError || !asset) {
        throw new Error(
          assetError?.message ?? "Failed to save generated video asset",
        );
      }

      let thumbnail:
        | {
            assetId: string;
            filePath: string;
          }
        | null = null;

      try {
        thumbnail = await saveGeneratedVideoThumbnail({
          submissionId: job.submission_id,
          jobId: job.id,
          filePath,
          videoBytes: bytes,
        });
      } catch (thumbnailError) {
        console.warn("Failed to generate video thumbnail", {
          jobId: job.id,
          submissionId: job.submission_id,
          error:
            thumbnailError instanceof Error
              ? thumbnailError.message
              : "Unknown thumbnail error",
        });
      }

      const completedAt = new Date().toISOString();
      const currentWorkflow = getSubmissionVideoWorkflowMetadata(
        submission.ai_metadata ?? null,
      );

      await supabase
        .from("generation_jobs")
        .update({
          status: "completed",
          completed_at: completedAt,
          failure_reason: null,
          result_asset_id: asset.id,
          result_storage_bucket: "uploads",
          result_file_path: filePath,
          result_payload: {
            ...(typeof job.result_payload === "object" && job.result_payload !== null
              ? job.result_payload
              : {}),
            provider,
            sourceVideoCount: signedVideoUrls.length,
            thumbnailAssetId: thumbnail?.assetId ?? null,
            thumbnailFilePath: thumbnail?.filePath ?? null,
          },
        })
        .eq("id", job.id);

      await supabase
        .from("submissions")
        .update({
          ai_metadata: mergeSubmissionVideoWorkflowMetadata(
            submission.ai_metadata ?? null,
            {
              currentJobId: job.id,
              lastCompletedJobId: job.id,
              providerOperationName: null,
              status: "generated",
              generatedAt: completedAt,
              lastFailureReason: null,
              durationSeconds: currentWorkflow.durationSeconds ?? 8,
              aspectRatio: currentWorkflow.aspectRatio ?? "9:16",
              resolution: currentWorkflow.resolution ?? "720p",
              resultStorageBucket: "uploads",
              resultFilePath: filePath,
              modelName: "render-quote-video",
            },
          ),
        })
        .eq("id", submission.id);

      return {
        jobId: job.id,
        status: "completed" as const,
        providerOperationName: null,
        resultAssetId: asset.id,
        resultFilePath: filePath,
        completed: true,
      };
    } catch (error) {
      const failureReason =
        error instanceof Error ? error.message : "Quote video generation failed";

      await supabase
        .from("generation_jobs")
        .update({
          status: "failed",
          failure_reason: failureReason,
          completed_at: new Date().toISOString(),
          result_payload: {
            ...(typeof job.result_payload === "object" && job.result_payload !== null
              ? job.result_payload
              : {}),
            provider,
          },
        })
        .eq("id", job.id);

      await supabase
        .from("submissions")
        .update({
          ai_metadata: mergeSubmissionVideoWorkflowMetadata(
            submission.ai_metadata ?? null,
            {
              currentJobId: job.id,
              providerOperationName: null,
              status: "draft",
              lastFailureReason: failureReason,
              modelName: "render-quote-video",
            },
          ),
        })
        .eq("id", submission.id);

      throw new Error(failureReason);
    }
  }

  if (!providerOperationName) {
    throw new Error("Gemini provider operation is missing");
  }

  const operation = await getGeminiVideoOperation(providerOperationName);

  if (!operation.done) {
    return {
      jobId: job.id,
      status: "processing" as const,
      providerOperationName,
      completed: false,
    };
  }

  if (operation.error?.message) {
    const failureReason = operation.error.message;

    await supabase
      .from("generation_jobs")
      .update({
        status: "failed",
        failure_reason: failureReason,
        completed_at: new Date().toISOString(),
        result_payload: {
          ...(typeof job.result_payload === "object" && job.result_payload !== null
            ? job.result_payload
            : {}),
          providerOperationName,
        },
      })
      .eq("id", job.id);

    await supabase
      .from("submissions")
      .update({
        ai_metadata: mergeSubmissionVideoWorkflowMetadata(
          submission.ai_metadata ?? null,
          {
            currentJobId: job.id,
            providerOperationName,
            status: "draft",
            lastFailureReason: failureReason,
          },
        ),
      })
      .eq("id", submission.id);

    throw new Error(failureReason);
  }

  const generatedVideo = extractGeneratedVideoFile(operation);

  if (!generatedVideo) {
    throw new Error("Generated video file was not returned by Gemini");
  }

  const bytes = await downloadGeminiVideoFile(generatedVideo.uri);
  const filePath = `${job.store_id}/${job.submission_id}/generated/${job.id}.mp4`;

  const { error: uploadError } = await supabase.storage
    .from("uploads")
    .upload(filePath, bytes, {
      contentType: generatedVideo.mimeType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data: asset, error: assetError } = await supabase
    .from("submission_assets")
    .insert({
      submission_id: job.submission_id,
      asset_type: "generated_video",
      storage_bucket: "uploads",
      file_path: filePath,
      file_name: `${job.id}.mp4`,
      mime_type: generatedVideo.mimeType,
      file_size: bytes.byteLength,
    })
    .select("id")
    .single();

  if (assetError || !asset) {
    throw new Error(assetError?.message ?? "Failed to save generated video asset");
  }

  let thumbnail:
    | {
        assetId: string;
        filePath: string;
      }
    | null = null;

  try {
    thumbnail = await saveGeneratedVideoThumbnail({
      submissionId: job.submission_id,
      jobId: job.id,
      filePath,
      videoBytes: bytes,
    });
  } catch (thumbnailError) {
    console.warn("Failed to generate video thumbnail", {
      jobId: job.id,
      submissionId: job.submission_id,
      error:
        thumbnailError instanceof Error
          ? thumbnailError.message
          : "Unknown thumbnail error",
    });
  }

  const completedAt = new Date().toISOString();
  const currentWorkflow = getSubmissionVideoWorkflowMetadata(
    submission.ai_metadata ?? null,
  );

  await supabase
    .from("generation_jobs")
    .update({
      status: "completed",
      completed_at: completedAt,
      failure_reason: null,
      result_asset_id: asset.id,
      result_storage_bucket: "uploads",
      result_file_path: filePath,
      result_payload: {
        providerOperationName,
        providerVideoUri: generatedVideo.uri,
        thumbnailAssetId: thumbnail?.assetId ?? null,
        thumbnailFilePath: thumbnail?.filePath ?? null,
      },
    })
    .eq("id", job.id);

  await supabase
    .from("submissions")
    .update({
      ai_metadata: mergeSubmissionVideoWorkflowMetadata(
        submission.ai_metadata ?? null,
        {
          currentJobId: job.id,
          lastCompletedJobId: job.id,
          providerOperationName,
          status: "generated",
          generatedAt: completedAt,
          lastFailureReason: null,
          durationSeconds: currentWorkflow.durationSeconds ?? 8,
          aspectRatio: currentWorkflow.aspectRatio ?? "9:16",
          resolution: currentWorkflow.resolution ?? "720p",
        },
      ),
    })
    .eq("id", submission.id);

  return {
    jobId: job.id,
    status: "completed" as const,
    providerOperationName,
    resultAssetId: asset.id,
    resultFilePath: filePath,
    completed: true,
  };
}
