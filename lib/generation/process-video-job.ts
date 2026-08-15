import {
  downloadGeminiVideoFile,
  extractGeneratedVideoFile,
  getGeminiVideoOperation,
} from "@/lib/ai/video";
import {
  getSubmissionVideoWorkflowMetadata,
  mergeSubmissionVideoWorkflowMetadata,
} from "@/lib/video-creation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

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
  const providerOperationName =
    typeof requestPayload.providerOperationName === "string"
      ? requestPayload.providerOperationName
      : null;

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
