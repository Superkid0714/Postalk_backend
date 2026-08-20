import type { SupabaseClient } from "@supabase/supabase-js";

import { mergeSubmissionWorkflowMetadata } from "@/lib/ad-creation";
import { buildWorkingCaptionMarkdown } from "@/lib/ai/video";
import {
  buildSessionStoreType,
  type AdSessionStore,
  type AdSessionWorkflow,
} from "@/lib/ad-session";
import { buildSubmissionVideoScript } from "@/lib/video-creation";

type SessionVideoAssetRow = {
  shot_key: string;
  asset_type: "video_clip";
  storage_bucket: string;
  file_path: string;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  sort_order: number;
};

type SessionRow = {
  id: string;
  store_id: string;
  intro_text: string;
  ad_type: "video";
};

function buildCaptionMarkdown(params: {
  script: ReturnType<typeof buildSubmissionVideoScript>;
}) {
  return buildWorkingCaptionMarkdown(params.script);
}

export async function createVideoSubmissionAndGenerationJobFromSession(params: {
  supabase: SupabaseClient;
  session: SessionRow;
  store: AdSessionStore;
  workflow: AdSessionWorkflow;
  assets: SessionVideoAssetRow[];
}) {
  const targetMenuName = params.workflow.primarySubject?.trim() || "대표 메뉴";
  const storeType = buildSessionStoreType(params.store);
  const generationRequestedAt = new Date().toISOString();
  const submissionSeed = {
    id: params.session.id,
    store_id: params.session.store_id,
    store_type: storeType,
    target_menu_name: targetMenuName,
    price_text: "",
    appeal_point: params.session.intro_text.trim(),
    extra_message: params.store.location_address ?? null,
    ai_metadata: null,
    stores: {
      market_name: params.store.market_name,
      store_name: params.store.store_name,
      owner_name: params.store.owner_name,
    },
  };
  const script = buildSubmissionVideoScript(submissionSeed, "market_story");
  const captionMarkdown = buildCaptionMarkdown({
    script,
  });

  const { data: submission, error: submissionError } = await params.supabase
    .from("submissions")
    .insert({
      store_id: params.session.store_id,
      submitter_name: "영상 광고 제작 세션",
      submitter_affiliation: "ad_session",
      qr_payload: null,
      store_type: storeType,
      target_menu_name: targetMenuName,
      price_text: "",
      appeal_point: params.session.intro_text.trim(),
      extra_message: params.store.location_address ?? null,
      title: `${params.store.store_name} 영상 광고`,
      caption: script.caption,
      hashtags: script.hashtags,
      transcript: null,
      ai_metadata: {
        adSession: {
          sessionId: params.session.id,
          primarySubject: targetMenuName,
        },
        videoWorkflow: {
          status: "generating",
          stylePreset: "market_story",
          durationSeconds: 8,
          aspectRatio: "9:16",
          resolution: "720p",
          script,
          generatedAt: null,
          requestedPublishAt: null,
          regenerateCount: 0,
          lastFailureReason: null,
        },
      },
      status: "pending_review",
    })
    .select("id, ai_metadata")
    .single();

  if (submissionError || !submission) {
    throw new Error(submissionError?.message ?? "Failed to create video submission");
  }

  const { data: job, error: jobError } = await params.supabase
    .from("generation_jobs")
    .insert({
      submission_id: submission.id,
      store_id: params.session.store_id,
      status: "queued",
      style_preset: "market_story",
      prompt_text: captionMarkdown,
      model_name: "render-quote-video",
      image_size: "9:16",
      quality: "720p",
      request_payload: {
        source: "ad-session",
        provider: "render-quote-video",
        adSessionId: params.session.id,
        adType: "video",
        stylePreset: "market_story",
        captionMarkdown,
        sourceVideos: params.assets.map((asset) => ({
          shotKey: asset.shot_key,
          storageBucket: asset.storage_bucket,
          filePath: asset.file_path,
          fileName: asset.file_name,
          mimeType: asset.mime_type,
          sortOrder: asset.sort_order,
        })),
      },
      result_payload: {
        script,
      },
    })
    .select("id, created_at, status")
    .single();

  if (jobError || !job) {
    throw new Error(jobError?.message ?? "Failed to create video generation job");
  }

  const { error: submissionUpdateError } = await params.supabase
    .from("submissions")
    .update({
      ai_metadata: {
        ...mergeSubmissionWorkflowMetadata(submission.ai_metadata, {
          adType: "video",
          publishRequestStatus: "generating",
          currentJobId: job.id,
          generationRequestedAt,
          lastFailureReason: null,
        }),
        videoWorkflow: {
          status: "generating",
          currentJobId: job.id,
          lastCompletedJobId: null,
          providerOperationName: null,
          durationSeconds: 8,
          aspectRatio: "9:16",
          resolution: "720p",
          stylePreset: "market_story",
          generatedAt: null,
          requestedPublishAt: null,
          regenerateCount: 0,
          lastFailureReason: null,
          resultStorageBucket: null,
          resultFilePath: null,
          modelName: "render-quote-video",
          mockMode: false,
          script,
        },
      },
    })
    .eq("id", submission.id);

  if (submissionUpdateError) {
    throw new Error(submissionUpdateError.message);
  }

  return {
    submissionId: submission.id,
    jobId: job.id,
    createdAt: job.created_at,
    status: job.status,
  };
}
