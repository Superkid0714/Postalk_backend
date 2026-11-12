import type { SupabaseClient } from "@supabase/supabase-js";
import { REELS_PROVIDER, renderReelInStorage, type ReelsInput } from "@/lib/ai/reels";
import { getUploadStorageBucket } from "@/lib/storage/media";
import { mergeSubmissionVideoWorkflowMetadata } from "@/lib/video-creation";

type ReelsJob = {
  id: string;
  submission_id: string;
  store_id: string;
  started_at: string | null;
  result_payload: Record<string, unknown> | null;
};

export async function processReelsJob(
  client: SupabaseClient,
  job: ReelsJob,
  metadata: Record<string, unknown> | null,
  payload: Record<string, unknown>,
) {
  const filePath = `${job.store_id}/${job.submission_id}/generated/${job.id}.mp4`;
  const bucket = getUploadStorageBucket();
  const started = await client.from("generation_jobs").update({
    status: "processing",
    started_at: job.started_at ?? new Date().toISOString(),
  }).eq("id", job.id);
  if (started.error) throw new Error(started.error.message);

  let render;
  try {
    const sources = Array.isArray(payload.sourceVideos) ? payload.sourceVideos : [];
    const input = payload.reelsInput as ReelsInput | undefined;
    if (!input || !Array.isArray(input.subtitles) || input.subtitles.length !== 4 ||
        !sources.every(source => source && typeof source.shotKey === "string" &&
          source.storageBucket === bucket && typeof source.filePath === "string" &&
          source.filePath.startsWith(`stores/${job.store_id}/`))) {
      throw new Error("Invalid reels job input");
    }
    render = await renderReelInStorage({ client, jobId: job.id, filePath, sources, input });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Reels render failed";
    const failed = await client.from("generation_jobs").update({
      status: "failed", failure_reason: reason, completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    if (failed.error) throw new Error(failed.error.message);
    await client.from("submissions").update({
      ai_metadata: mergeSubmissionVideoWorkflowMetadata(metadata, { status: "draft", lastFailureReason: reason }),
    }).eq("id", job.submission_id);
    throw new Error(reason);
  }

  async function saveAsset(path: string, kind: "generated_video" | "video_thumbnail", mimeType: string, bytes: number) {
    const { data: existing, error } = await client.from("submission_assets").select("id")
      .eq("submission_id", job.submission_id).eq("file_path", path).maybeSingle();
    if (error) throw new Error(error.message);
    const fields = {
      generation_job_id: job.id, storage_bucket: bucket, file_size: bytes, mime_type: mimeType,
    };
    if (existing) {
      const result = await client.from("submission_assets").update(fields).eq("id", existing.id);
      if (result.error) throw new Error(result.error.message);
      return existing.id as string;
    }
    const result = await client.from("submission_assets").insert({
      ...fields, submission_id: job.submission_id, asset_type: kind, file_path: path,
      file_name: path.split("/").at(-1), sort_order: 0,
    }).select("id").single();
    if (result.error || !result.data) throw new Error(result.error?.message ?? "Unable to register reel asset");
    return result.data.id as string;
  }

  try {
    const assetId = await saveAsset(filePath, "generated_video", "video/mp4", render.videoBytes);
    const thumbnailAssetId = await saveAsset(render.thumbnailPath, "video_thumbnail", "image/jpeg", render.thumbnailBytes);
    const completedAt = new Date().toISOString();
    const submission = await client.from("submissions").update({
      ai_metadata: mergeSubmissionVideoWorkflowMetadata(metadata, {
        status: "generated", currentJobId: job.id, lastCompletedJobId: job.id,
        providerOperationName: render.renderId, generatedAt: completedAt, lastFailureReason: null,
        durationSeconds: 13, aspectRatio: "9:16", resolution: "1080p",
        resultStorageBucket: bucket, resultFilePath: filePath, modelName: REELS_PROVIDER,
      }),
    }).eq("id", job.submission_id);
    if (submission.error) throw new Error(submission.error.message);
    const updated = await client.from("generation_jobs").update({
      status: "completed", completed_at: completedAt, failure_reason: null, result_asset_id: assetId,
      result_storage_bucket: bucket, result_file_path: filePath,
      result_payload: {
        ...job.result_payload, provider: REELS_PROVIDER, renderId: render.renderId,
        durationSeconds: render.durationSeconds, thumbnailAssetId, thumbnailFilePath: render.thumbnailPath,
      },
    }).eq("id", job.id);
    if (updated.error) throw new Error(updated.error.message);
    return { jobId: job.id, status: "completed" as const, completed: true, resultFilePath: filePath };
  } catch (error) {
    // Keep the job recoverable if storage succeeded but the database write was interrupted.
    console.error("Unable to register completed reel", { jobId: job.id, error });
    return { jobId: job.id, status: "processing" as const, completed: false };
  }
}
