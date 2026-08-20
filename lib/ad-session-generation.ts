import {
  buildSubmissionPrompt,
  mergeSubmissionWorkflowMetadata,
} from "@/lib/ad-creation";
import {
  buildSessionStoreType,
  type AdSessionStore,
  type AdSessionWorkflow,
} from "@/lib/ad-session";
import type { GenerationStylePreset } from "@/lib/ai/generation";
import type { SupabaseClient } from "@supabase/supabase-js";

type SessionAssetRow = {
  shot_key: string;
  asset_type: "menu_board" | "food_photo";
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
  ad_type: "photo" | "video";
  style_preset: string;
};

function resolveImageSize(stylePreset: GenerationStylePreset) {
  return stylePreset === "food_card_news" ? "1024x1536" : "1536x1024";
}

export async function createSubmissionAndGenerationJobFromSession(params: {
  supabase: SupabaseClient;
  session: SessionRow;
  store: AdSessionStore;
  workflow: AdSessionWorkflow;
  assets: SessionAssetRow[];
}) {
  const stylePreset = (params.session.style_preset ||
    "food_card_news") as GenerationStylePreset;
  const targetMenuName = params.workflow.primarySubject?.trim() || "대표 메뉴";
  const storeType = buildSessionStoreType(params.store);
  const generationRequestedAt = new Date().toISOString();
  const menuIntro = params.workflow.menuIntro?.trim() || params.session.intro_text.trim();
  const storeSpecialty =
    params.workflow.storeSpecialty?.trim() || params.store.description?.trim() || null;
  const draftCaption = params.workflow.draftCaption?.trim() || null;
  const draftHashtags = (params.workflow.draftHashtags ?? []).filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  const draftFoodCardNewsPlan = params.workflow.draftFoodCardNewsPlan ?? null;
  const draftCarouselPrompts = params.workflow.draftCarouselPrompts ?? [];

  const { data: submission, error: submissionError } = await params.supabase
    .from("submissions")
    .insert({
      store_id: params.session.store_id,
      submitter_name: "광고 제작 세션",
      submitter_affiliation: "ad_session",
      qr_payload: null,
      store_type: storeType,
      target_menu_name: targetMenuName,
      price_text: "",
      appeal_point: menuIntro,
      extra_message: storeSpecialty,
      title: `${params.store.store_name} 카드뉴스`,
      caption: draftCaption,
      hashtags: draftHashtags,
      transcript: null,
      ai_metadata: mergeSubmissionWorkflowMetadata(
        {
          adSession: {
            sessionId: params.session.id,
            primarySubject: targetMenuName,
            menuIntro,
            storeSpecialty,
          },
          merchantInsights: {
            targetCustomer: null,
            peakSalesTime: null,
            popularMenuNotes: menuIntro,
          },
        },
        {
          adType: params.session.ad_type,
          publishRequestStatus: "generating",
          generationRequestedAt,
          currentJobId: null,
          lastCompletedJobId: null,
          lastFailureReason: null,
        },
      ),
      status: "pending_review",
    })
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
      )
    `)
    .single();

  if (submissionError || !submission) {
    throw new Error(submissionError?.message ?? "Failed to create submission");
  }

  const { error: assetError } = await params.supabase.from("submission_assets").insert(
    params.assets.map((asset) => ({
      submission_id: submission.id,
      asset_type: asset.asset_type,
      storage_bucket: asset.storage_bucket,
      file_path: asset.file_path,
      file_name: asset.file_name,
      mime_type: asset.mime_type,
      file_size: asset.file_size,
      sort_order: asset.sort_order,
    })),
  );

  if (assetError) {
    throw new Error(assetError.message);
  }

  const promptText = buildSubmissionPrompt(submission, stylePreset);

  const { data: job, error: jobError } = await params.supabase
    .from("generation_jobs")
    .insert({
      submission_id: submission.id,
      store_id: params.session.store_id,
      status: "queued",
      style_preset: stylePreset,
      prompt_text: promptText,
      model_name: "gpt-image-2",
      image_size: resolveImageSize(stylePreset),
      quality: "medium",
      request_payload: {
        source: "ad-session",
        adSessionId: params.session.id,
        adType: params.session.ad_type,
        stylePreset,
        precomputedCaption: draftCaption,
        precomputedHashtags: draftHashtags,
        precomputedFoodCardNewsPlan: draftFoodCardNewsPlan,
        precomputedCarouselPrompts: draftCarouselPrompts,
      },
    })
    .select("id, created_at, status")
    .single();

  if (jobError || !job) {
    throw new Error(jobError?.message ?? "Failed to create generation job");
  }

  const { error: submissionUpdateError } = await params.supabase
    .from("submissions")
    .update({
      ai_metadata: mergeSubmissionWorkflowMetadata(submission.ai_metadata, {
        adType: params.session.ad_type,
        publishRequestStatus: "generating",
        currentJobId: job.id,
        generationRequestedAt,
        lastFailureReason: null,
      }),
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
