import {
  buildPromoCarouselPrompts,
  generateFoodCardNewsPlan,
  generatePromoCaption,
  type SubmissionForGeneration,
} from "@/lib/ai/generation";
import {
  normalizeAdSessionWorkflow,
  type AdSessionStore,
  type AdSessionWorkflow,
} from "@/lib/ad-session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type SessionPreparationAssetRow = {
  shot_key: string;
  asset_type: "menu_board" | "food_photo" | "video_clip";
  storage_bucket: string;
  file_path: string;
  sort_order: number;
};

type SessionPreparationRow = {
  id: string;
  intro_text: string;
  style_preset: string;
  workflow: unknown;
  stores:
    | {
        market_name: string;
        store_name: string;
        owner_name: string | null;
        category: string | null;
        description: string | null;
      }
    | Array<{
        market_name: string;
        store_name: string;
        owner_name: string | null;
        category: string | null;
        description: string | null;
      }>
    | null;
  ad_creation_session_assets?: SessionPreparationAssetRow[] | null;
};

function normalizeStoreRelation(
  stores: SessionPreparationRow["stores"],
): AdSessionStore & {
  latitude?: number | null;
  longitude?: number | null;
} {
  const store = Array.isArray(stores) ? stores[0] : stores;

  return {
    id: "",
    market_name: store?.market_name ?? "전통시장",
    store_name: store?.store_name ?? "가게",
    owner_name: store?.owner_name ?? null,
    category: store?.category ?? null,
    location_address: store?.description ?? null,
    latitude: null,
    longitude: null,
  };
}

function buildDraftSubmission(
  session: SessionPreparationRow,
  workflow: AdSessionWorkflow,
) {
  const store = normalizeStoreRelation(session.stores);
  const assets = (session.ad_creation_session_assets ?? [])
    .filter(
      (asset): asset is SessionPreparationAssetRow & {
        asset_type: "menu_board" | "food_photo";
      } => asset.asset_type === "menu_board" || asset.asset_type === "food_photo",
    )
    .map((asset) => ({
      asset_type: asset.asset_type,
      storage_bucket: asset.storage_bucket,
      file_path: asset.file_path,
      sort_order: asset.sort_order,
    }));

  return {
    id: session.id,
    title: `${store.store_name} 카드뉴스`,
    caption: workflow.draftCaption ?? workflow.caption ?? null,
    store_type: store.category ?? "전통시장 점포",
    target_menu_name: workflow.primarySubject?.trim() || "대표 메뉴",
    price_text: null,
    appeal_point: session.intro_text.trim(),
    extra_message: store.location_address ?? null,
    ai_metadata: {
      merchantInsights: {},
      adSession: {
        sessionId: session.id,
      },
    },
    stores: {
      market_name: store.market_name,
      store_name: store.store_name,
      owner_name: store.owner_name,
      latitude: store.latitude ?? null,
      longitude: store.longitude ?? null,
      location_address: store.location_address,
    },
    submission_assets: assets,
  } satisfies SubmissionForGeneration;
}

export async function prepareAdSessionDrafts(sessionId: string) {
  const supabase = getSupabaseAdminClient();
  const { data: session, error } = await supabase
    .from("ad_creation_sessions")
    .select(`
      id,
      intro_text,
      style_preset,
      workflow,
      stores (
        market_name,
        store_name,
        owner_name,
        category,
        description
      ),
      ad_creation_session_assets (
        shot_key,
        asset_type,
        storage_bucket,
        file_path,
        sort_order
      )
    `)
    .eq("id", sessionId)
    .single();

  if (error || !session) {
    throw new Error(error?.message ?? "Ad session not found");
  }

  const workflow = normalizeAdSessionWorkflow(session.workflow);
  const submission = buildDraftSubmission(session, workflow);
  const captionResult = await generatePromoCaption(submission);
  const foodCardNewsPlan =
    session.style_preset === "food_card_news"
      ? await generateFoodCardNewsPlan({
          ...submission,
          caption: captionResult.caption,
        })
      : null;
  const carouselPrompts = buildPromoCarouselPrompts(
    {
      ...submission,
      caption: captionResult.caption,
    },
    session.style_preset as
      | "menu_highlight"
      | "clean_poster"
      | "market_story"
      | "food_card_news",
    {
      foodCardNewsPlan,
    },
  ).map((item) => ({
    index: item.index,
    key: item.key,
    prompt: item.prompt,
  }));

  const nextWorkflow = {
    ...workflow,
    draftCaption: captionResult.caption,
    draftHashtags: captionResult.hashtags,
    draftFoodCardNewsPlan: foodCardNewsPlan,
    draftCarouselPrompts: carouselPrompts,
    draftPreparedAt: new Date().toISOString(),
    draftAssetCount: session.ad_creation_session_assets?.length ?? 0,
  };

  const { error: updateError } = await supabase
    .from("ad_creation_sessions")
    .update({
      workflow: nextWorkflow,
    })
    .eq("id", sessionId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return {
    sessionId,
    draftCaption: captionResult.caption,
    draftHashtags: captionResult.hashtags,
    draftPreparedAt: nextWorkflow.draftPreparedAt,
    draftAssetCount: nextWorkflow.draftAssetCount,
  };
}
