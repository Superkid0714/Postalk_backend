import type { SupabaseClient } from "@supabase/supabase-js";
import { CARDNEWS_PROVIDER, renderCardNews, type CardNewsInput } from "@/lib/ai/cardnews-service";
import { mergeSubmissionWorkflowMetadata } from "@/lib/ad-creation";
import { getUploadStorageBucket } from "@/lib/storage/media";

export async function processCardNewsJob(
  client: SupabaseClient,
  job: { id: string; submission_id: string; store_id: string; status: string; request_payload: unknown },
  metadata: Record<string, unknown> | null,
) {
  if (job.status === "failed") return { jobId: job.id, status: "failed" as const };
  const bucket = getUploadStorageBucket();
  const started = await client.from("generation_jobs").update({
    status: "processing", started_at: new Date().toISOString(),
  }).eq("id", job.id);
  if (started.error) throw new Error(started.error.message);

  let result;
  let caption: string;
  try {
    const input = (job.request_payload as { cardNewsInput?: CardNewsInput } | null)?.cardNewsInput;
    if (!input) throw new Error("Card news input is missing");
    caption = input.caption;
    result = await renderCardNews(client, input, { storeId: job.store_id, submissionId: job.submission_id, jobId: job.id });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Card news render failed";
    const failed = await client.from("generation_jobs").update({
      status: "failed", completed_at: new Date().toISOString(), failure_reason: reason,
    }).eq("id", job.id);
    if (failed.error) throw new Error(failed.error.message);
    await client.from("submissions").update({
      ai_metadata: mergeSubmissionWorkflowMetadata(metadata, {
        publishRequestStatus: "draft", currentJobId: job.id, lastFailureReason: reason,
      }),
    }).eq("id", job.submission_id);
    throw new Error(reason);
  }

  try {
    const generatedImages = [];
    for (const [index, card] of result.cards.entries()) {
      const { data: existing, error } = await client.from("submission_assets").select("id")
        .eq("submission_id", job.submission_id).eq("file_path", card.key).maybeSingle();
      if (error) throw new Error(error.message);
      const fields = {
        asset_type: "generated_image", generation_job_id: job.id, file_path: card.key,
        storage_bucket: bucket, file_name: card.key.split("/").at(-1),
        mime_type: "image/png", file_size: card.bytes, sort_order: index,
      };
      const saved = existing
        ? await client.from("submission_assets").update(fields).eq("id", existing.id).select("id").single()
        : await client.from("submission_assets").insert({ ...fields, submission_id: job.submission_id }).select("id").single();
      if (saved.error || !saved.data) throw new Error(saved.error?.message ?? "Unable to register the card");
      generatedImages.push({ assetId: saved.data.id as string, filePath: card.key, promptKey: `card-${index + 1}` });
    }

    const completedAt = new Date().toISOString();
    const submission = await client.from("submissions").update({
      caption,
      ai_metadata: mergeSubmissionWorkflowMetadata(metadata, {
        adType: "photo", publishRequestStatus: "generated", currentJobId: job.id,
        lastCompletedJobId: job.id, generatedAt: completedAt, lastFailureReason: null,
      }),
    }).eq("id", job.submission_id);
    if (submission.error) throw new Error(submission.error.message);
    const first = generatedImages[0];
    const completed = await client.from("generation_jobs").update({
      status: "completed", completed_at: completedAt, failure_reason: null,
      result_asset_id: first.assetId, result_storage_bucket: bucket, result_file_path: first.filePath,
      result_payload: {
        provider: CARDNEWS_PROVIDER, generatedImages, imageCount: generatedImages.length,
        template: result.template, fallback: result.fallback,
      },
    }).eq("id", job.id);
    if (completed.error) throw new Error(completed.error.message);
    return { jobId: job.id, status: "completed" as const, resultAssetId: first.assetId,
      filePath: first.filePath, imageCount: generatedImages.length };
  } catch (error) {
    console.error("Unable to register rendered card news", { jobId: job.id, error });
    return { jobId: job.id, status: "processing" as const };
  }
}
