import { getOpenAiApiKey } from "@/lib/env";
import {
  buildDefaultFoodCardNewsPlan,
  buildFoodCardNewsPrompts,
  type FoodCardNewsCreativePlan,
  isFoodCardNewsEligible,
} from "@/lib/ai/food-card-news";
import {
  buildCaptionInputContext,
  buildFestivalEvidenceItems,
  buildKamisEvidenceItems,
  buildMarketEvidenceItems,
  buildMerchantEvidenceItems,
  buildTourismCorpusEvidenceItems,
  buildWeatherEvidenceItems,
  type CaptionInputContext,
} from "@/lib/ai/context";
import { fetchWithTimeout } from "@/lib/http";
import type { KamisContext } from "@/lib/public-data/kamis";
import type { FestivalContext } from "@/lib/public-data/tour-festival";
import type { TourismCorpusContext } from "@/lib/public-data/tourism-corpus";
import type {
  CaptionEvidenceItem,
  MarketContext,
} from "@/lib/public-data/traditional-market";
import type { WeatherContext } from "@/lib/weather/context";

const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_IMAGE_SIZE = "1536x1024";
const DEFAULT_IMAGE_QUALITY = "medium";
const PROMO_CAPTION_MODEL = "gpt-4.1-mini";

export type ImageGenerationStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type GenerationStylePreset =
  | "menu_highlight"
  | "clean_poster"
  | "market_story"
  | "food_card_news";

export type GenerationJobRow = {
  id: string;
  submission_id: string;
  store_id: string;
  status: ImageGenerationStatus;
  style_preset: GenerationStylePreset;
  prompt_text: string | null;
  model_name: string;
  image_size: string;
  quality: string;
  failure_reason: string | null;
  result_asset_id: string | null;
  result_storage_bucket: string | null;
  result_file_path: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type SubmissionForGeneration = {
  id: string;
  store_id?: string;
  title: string | null;
  caption: string | null;
  store_type: string;
  target_menu_name: string;
  price_text: string | null;
  appeal_point: string;
  extra_message: string | null;
  ai_metadata?: Record<string, unknown> | null;
  stores: {
    market_name: string;
    store_name: string;
    owner_name: string | null;
    latitude?: number | null;
    longitude?: number | null;
    location_address?: string | null;
  } | null;
  submission_assets?:
    | Array<{
        asset_type:
          | "menu_board"
          | "food_photo"
          | "generated_image"
          | "generated_video"
          | "video_thumbnail";
        storage_bucket: string;
        file_path: string;
        sort_order: number;
      }>
    | null;
};

export function normalizeStoreRelation(stores: unknown) {
  const source = Array.isArray(stores) ? stores[0] : stores;

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  const record = source as Record<string, unknown>;

  return {
    market_name:
      typeof record.market_name === "string" ? record.market_name : "전통시장",
    store_name: typeof record.store_name === "string" ? record.store_name : "가게",
    owner_name:
      typeof record.owner_name === "string" ? record.owner_name : null,
    latitude:
      typeof record.latitude === "number" ? record.latitude : null,
    longitude:
      typeof record.longitude === "number" ? record.longitude : null,
    location_address:
      typeof record.location_address === "string"
        ? record.location_address
        : typeof record.description === "string"
          ? record.description
          : null,
  } satisfies SubmissionForGeneration["stores"];
}

export function normalizeSubmissionRelation(submissions: unknown) {
  if (Array.isArray(submissions)) {
    return (submissions[0] as SubmissionForGeneration) ?? null;
  }

  return (submissions as SubmissionForGeneration) ?? null;
}

type OpenAiImageResponse = {
  data?: Array<{
    b64_json?: string;
    revised_prompt?: string;
    url?: string;
  }>;
};

type OpenAiResponsesResponse = {
  output_text?: string;
};

type MerchantInsights = {
  targetCustomer: string | null;
  peakSalesTime: string | null;
  popularMenuNotes: string | null;
};

export type GeneratedPromoCaption = {
  caption: string;
  hashtags: string[];
  marketContext: MarketContext;
  weatherContext: WeatherContext;
  festivalContext: FestivalContext;
  kamisContext: KamisContext;
  tourismCorpusContext: TourismCorpusContext;
  captionInputContext: CaptionInputContext;
  evidence: CaptionEvidenceItem[];
};

type PromoCarouselVariant = {
  key:
    | "hero"
    | "detail"
    | "price"
    | "audience"
    | "market_story"
    | "popular_demand"
    | "cta";
  instruction: string;
};

type FoodVisualProfile = {
  category: string;
  heroFocus: string;
  stylingDirection: string;
  backgroundDirection: string;
  colorDirection: string;
};

function readMerchantInsights(
  aiMetadata: Record<string, unknown> | null | undefined,
): MerchantInsights {
  if (!aiMetadata || typeof aiMetadata !== "object" || Array.isArray(aiMetadata)) {
    return {
      targetCustomer: null,
      peakSalesTime: null,
      popularMenuNotes: null,
    };
  }

  const merchantInsights = aiMetadata.merchantInsights;

  if (
    !merchantInsights ||
    typeof merchantInsights !== "object" ||
    Array.isArray(merchantInsights)
  ) {
    return {
      targetCustomer: null,
      peakSalesTime: null,
      popularMenuNotes: null,
    };
  }

  const record = merchantInsights as Record<string, unknown>;

  return {
    targetCustomer:
      typeof record.targetCustomer === "string" ? record.targetCustomer : null,
    peakSalesTime:
      typeof record.peakSalesTime === "string" ? record.peakSalesTime : null,
    popularMenuNotes:
      typeof record.popularMenuNotes === "string" ? record.popularMenuNotes : null,
  };
}

function inferFoodVisualProfile(
  storeType: string,
  targetMenuName: string,
): FoodVisualProfile {
  const source = `${storeType} ${targetMenuName}`.toLowerCase();

  if (
    /회|초밥|스시|해산물|fish|sashimi|sushi/.test(source)
  ) {
    return {
      category: "seafood",
      heroFocus: "fresh sliced seafood, glossy surface, knife-cut texture, chilled freshness",
      stylingDirection: "clean plating, precise arrangement, premium freshness, moist highlights, minimal garnish",
      backgroundDirection: "subtle wooden table or market seafood counter mood with restrained props",
      colorDirection: "cool neutrals, deep wood, restrained green garnish, crisp highlights",
    };
  }

  if (/국밥|탕|찌개|전골|라면|우동|칼국수|국수|soup|noodle/.test(source)) {
    return {
      category: "hot_soup",
      heroFocus: "rising steam, rich broth, generous ingredients, deep bowl texture",
      stylingDirection: "comforting warmth, visible steam, depth in broth, hearty serving",
      backgroundDirection: "clean tabletop with subtle side dishes and warm ambient market lighting",
      colorDirection: "warm amber, ivory steam haze, earthy neutrals, appetizing red accents",
    };
  }

  if (/치킨|튀김|돈까스|fried|cutlet/.test(source)) {
    return {
      category: "fried",
      heroFocus: "crisp golden crust, crunchy texture, juicy interior, dynamic close-up",
      stylingDirection: "high texture contrast, dramatic side light, energetic food-ad styling",
      backgroundDirection: "dark clean background or subtle market setting to emphasize crunch",
      colorDirection: "golden brown, deep charcoal, bright highlight contrast",
    };
  }

  if (/고기|갈비|삼겹|불고기|족발|보쌈|barbecue|meat/.test(source)) {
    return {
      category: "meat",
      heroFocus: "char, glaze, juicy meat fibers, sizzling richness",
      stylingDirection: "luxurious savory mood, glossy highlights, rich shadows, premium heft",
      backgroundDirection: "grill or tabletop hints with restrained banchan presence",
      colorDirection: "deep brown, bronze, warm smoke tones, rich contrast",
    };
  }

  if (/반찬|김치|나물|도시락|밑반찬|side dish/.test(source)) {
    return {
      category: "side_dish",
      heroFocus: "abundant variety, handmade detail, vibrant ingredients, appetizing arrangement",
      stylingDirection: "organized abundance, home-style warmth, neat market-premium presentation",
      backgroundDirection: "clean tray or market display context with subtle household warmth",
      colorDirection: "balanced natural tones, fresh vegetable colors, gentle warmth",
    };
  }

  if (/디저트|빵|베이커리|케이크|커피|dessert|bakery/.test(source)) {
    return {
      category: "dessert",
      heroFocus: "soft texture, delicate detail, inviting sweetness, polished finish",
      stylingDirection: "clean premium cafe-style presentation with soft highlights",
      backgroundDirection: "simple elegant backdrop with airy depth and minimal props",
      colorDirection: "soft cream, warm beige, restrained accent colors, gentle highlights",
    };
  }

  return {
    category: "general_food",
    heroFocus: "clear appetizing hero dish, fresh texture, believable portion, immediate craving appeal",
    stylingDirection: "premium but approachable Korean food-ad styling, realistic detail, clean composition",
    backgroundDirection: "subtle traditional-market cues with limited props and strong subject separation",
    colorDirection: "warm balanced palette with natural contrast and clean highlights",
  };
}

function buildShortCopyGuidance(
  submission: SubmissionForGeneration,
  merchantInsights: MerchantInsights,
) {
  return [
    `Possible Korean headline mood: ${submission.target_menu_name} 중심의 짧고 강한 한 줄.`,
    submission.price_text
      ? `Possible price lockup: ${submission.price_text} 정보를 짧고 굵게 강조.`
      : "If price is omitted, focus on craving and specialty rather than inventing a price.",
    merchantInsights.targetCustomer
      ? `Reflect this audience naturally in tone: ${merchantInsights.targetCustomer}.`
      : null,
    merchantInsights.peakSalesTime
      ? `If useful, imply urgency around this timing: ${merchantInsights.peakSalesTime}.`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function pickPrioritySupportMessage(
  submission: SubmissionForGeneration,
  merchantInsights: MerchantInsights,
) {
  if (merchantInsights.targetCustomer?.trim()) {
    return `${merchantInsights.targetCustomer.trim()} 손님이 편하게 찾기 좋은 한 끼로 기억될 수 있게 담았습니다.`;
  }

  if (merchantInsights.peakSalesTime?.trim()) {
    return `${merchantInsights.peakSalesTime.trim()}에 자연스럽게 생각나는 메뉴 분위기로 정리했습니다.`;
  }

  if (submission.extra_message?.trim()) {
    return `${submission.extra_message.trim().replace(/[.。!！?？]+$/u, "")} 분위기까지 함께 전해지도록 담았습니다.`;
  }

  return `${submission.target_menu_name} 생각나는 날 부담 없이 다시 찾고 싶은 분위기로 정리했습니다.`;
}

function compactSentence(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const cleaned = value
    .replace(/^(주력 메뉴를 포함한 대표 메뉴 소개|가게만의 특별함)\s*:\s*/u, "")
    .replace(/^(대표메뉴|대표 메뉴)(는|가)?\s*/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.。!！?？]+$/u, "");

  return cleaned.length > 0 ? cleaned : null;
}

function stripRepeatedMenuLead(value: string | null, menuName: string) {
  if (!value) {
    return null;
  }

  const escapedMenu = menuName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cleaned = value
    .replace(
      new RegExp(`^${escapedMenu}(?:입니다|이에요|예요|입니다만)?[.!?。！？]*\\s*`, "u"),
      "",
    )
    .trim();

  return cleaned.length > 0 ? cleaned : value;
}

function deriveMarketingHashtags(source: string | null | undefined) {
  const text = source?.replace(/\s+/g, "") ?? "";
  const tags: string[] = [];

  if (text.includes("불향")) tags.push("#불향가득");
  if (text.includes("직화")) tags.push("#직화매력");
  if (text.includes("전통")) tags.push("#전통손맛");
  if (text.includes("푸짐")) tags.push("#푸짐한한끼");
  if (text.includes("포장")) tags.push("#포장추천");
  if (text.includes("매콤")) tags.push("#매콤한한입");

  return tags;
}

function formatFestivalDateRange(
  festivalContext?: FestivalContext | null,
) {
  if (
    !festivalContext?.event_start_date ||
    !festivalContext.event_end_date
  ) {
    return null;
  }

  return `${festivalContext.event_start_date}~${festivalContext.event_end_date}`;
}

export function buildPublicDataFlavorText(params: {
  marketContext?: MarketContext | null;
  weatherContext?: WeatherContext | null;
  festivalContext?: FestivalContext | null;
  kamisContext?: KamisContext | null;
  tourismCorpusContext?: TourismCorpusContext | null;
}) {
  const {
    marketContext,
    weatherContext,
    festivalContext,
    kamisContext,
    tourismCorpusContext,
  } = params;

  if (festivalContext?.found && festivalContext.verified && festivalContext.title) {
    return `${festivalContext.title} 무렵 들르기 좋은 분위기까지 함께 전해집니다.`;
  }

  if (weatherContext?.selected_for_prompt && weatherContext.summary) {
    return weatherContext.summary.replace(
      / 활용할 수 있음$/u,
      " 잘 어울리는 메뉴 분위기입니다.",
    );
  }

  if (marketContext?.found && marketContext.market_name) {
    return `${marketContext.market_name}${marketContext.district ? ` ${marketContext.district}` : ""}에서 자연스럽게 떠오를 만한 한 끼입니다.`;
  }

  if (kamisContext?.selected_for_prompt && kamisContext.region) {
    return `${kamisContext.region} 장보기 동선에서도 편하게 떠올리기 좋은 메뉴 톤입니다.`;
  }

  if (tourismCorpusContext?.selected_for_prompt && tourismCorpusContext.region_scope) {
    return `${tourismCorpusContext.region_scope} 특유의 정감과 잘 어울리는 메뉴 결을 담았습니다.`;
  }

  return null;
}

function buildHashtagCandidates(
  submission: SubmissionForGeneration,
  merchantInsights: MerchantInsights,
  marketContext?: MarketContext | null,
  festivalContext?: FestivalContext | null,
) {
  const candidates = [
    submission.stores?.market_name,
    submission.stores?.store_name,
    submission.target_menu_name,
    marketContext?.district ? `${marketContext.district}맛집` : null,
    marketContext?.province
      ? `${marketContext.province.replace(/광역시|특별시|특별자치시|특별자치도|도$/gu, "")}시장`
      : null,
    merchantInsights.targetCustomer
      ? `${merchantInsights.targetCustomer.replace(/\s+/g, "")}추천`
      : null,
    merchantInsights.peakSalesTime
      ? merchantInsights.peakSalesTime.replace(/\s+/g, "")
      : null,
    merchantInsights.popularMenuNotes?.includes("포장") ? "포장맛집" : null,
    merchantInsights.popularMenuNotes?.includes("점심") ? "점심추천" : null,
    merchantInsights.popularMenuNotes?.includes("저녁") ? "저녁메뉴" : null,
    festivalContext?.found && festivalContext.verified && festivalContext.title
      ? festivalContext.title.replace(/\s+/g, "")
      : null,
  ];

  return [
    ...new Set(
      [
        ...candidates
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .map((value) => `#${value.replace(/\s+/g, "")}`),
        ...deriveMarketingHashtags(submission.appeal_point),
        ...deriveMarketingHashtags(submission.extra_message),
      ],
    ),
  ].slice(0, 5);
}

function buildCaptionFallback(
  submission: SubmissionForGeneration,
  merchantInsights: MerchantInsights,
  marketContext?: MarketContext | null,
  weatherContext?: WeatherContext | null,
  festivalContext?: FestivalContext | null,
  kamisContext?: KamisContext | null,
  tourismCorpusContext?: TourismCorpusContext | null,
){
  const cleanedAppeal = stripRepeatedMenuLead(
    compactSentence(submission.appeal_point),
    submission.target_menu_name,
  );
  const cleanedExtra = compactSentence(submission.extra_message);
  const intro = merchantInsights.peakSalesTime
    ? `${merchantInsights.peakSalesTime.trim()}에 더 당기는 ${submission.target_menu_name}, 든든하게 즐기기 좋은 메뉴입니다.`
    : `${submission.target_menu_name} 생각나는 날, 먼저 눈길이 가는 한 접시입니다.`;
  const appealSentence = cleanedAppeal
    ? `${cleanedAppeal} 매력이 또렷해서 처음 찾는 손님에게도 자신 있게 권하기 좋습니다.`
    : null;
  const publicDataFlavor = buildPublicDataFlavorText({
    marketContext,
    weatherContext,
    festivalContext,
    kamisContext,
    tourismCorpusContext,
  });
  const contextSentence =
    merchantInsights.targetCustomer
      ? `${merchantInsights.targetCustomer} 손님이 편하게 고르고 만족스럽게 즐기기 좋은 분위기를 함께 담았습니다.`
      : publicDataFlavor;
  const closingSentence = cleanedExtra
    ? `${cleanedExtra} 매력까지 함께 느끼고 싶다면 한 번쯤 찾게 되는 메뉴입니다.`
    : pickPrioritySupportMessage(submission, merchantInsights);

  const caption = [
    intro,
    appealSentence,
    contextSentence,
    closingSentence,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");

  const hashtags = buildHashtagCandidates(
    submission,
    merchantInsights,
    marketContext,
    festivalContext,
  );

  return {
    caption,
    hashtags,
  };
}

function stripCodeFence(value: string) {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function normalizeHashtags(
  candidate: unknown,
  fallback: string[],
) {
  const normalized = Array.isArray(candidate)
    ? candidate
        .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
        .map((tag) => {
          const compact = tag.trim().replace(/\s+/g, "");
          return compact.startsWith("#") ? compact : `#${compact}`;
        })
    : [];

  const unique = [...new Set(normalized)].slice(0, 5);
  return unique.length >= 3 ? unique : fallback;
}

export function normalizePromoCaptionOutput(
  candidate: unknown,
  fallback: { caption: string; hashtags: string[] },
) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return fallback;
  }

  const record = candidate as Record<string, unknown>;
  const caption =
    typeof record.caption === "string" && record.caption.trim().length > 0
      ? record.caption
          .replace(/\s+/g, " ")
          .replace(/^(주력 메뉴를 포함한 대표 메뉴 소개|가게만의 특별함)\s*:\s*/gu, "")
          .trim()
      : fallback.caption;

  if (caption.length < 20 || caption.length > 240) {
    return fallback;
  }

  return {
    caption,
    hashtags: normalizeHashtags(record.hashtags, fallback.hashtags),
  };
}

async function reviewPromoCaptionDraft(params: {
  apiKey: string;
  submission: SubmissionForGeneration;
  merchantInsights: MerchantInsights;
  draft: { caption: string; hashtags: string[] };
  marketContext: MarketContext;
  weatherContext: WeatherContext;
  festivalContext: FestivalContext;
  kamisContext: KamisContext;
  tourismCorpusContext: TourismCorpusContext;
}) {
  const publicDataFlavor = buildPublicDataFlavorText({
    marketContext: params.marketContext,
    weatherContext: params.weatherContext,
    festivalContext: params.festivalContext,
    kamisContext: params.kamisContext,
    tourismCorpusContext: params.tourismCorpusContext,
  });

  const prompt = [
    "You are the final Korean copy editor for a traditional-market food Instagram ad.",
    "Rewrite the draft caption so it sounds natural, appetizing, and publishable in Korean.",
    "Return strict JSON only with keys: caption, hashtags.",
    "Rules:",
    "- Keep 3 to 4 Korean sentences.",
    "- Make the Korean read naturally to real customers.",
    "- Remove awkward AI-sounding phrasing, label-like wording, and repetition.",
    "- Merchant facts must stay primary.",
    "- If verified public-data flavor exists, reflect only one subtle local/timing cue.",
    "- Public-data flavor must feel natural, not official or report-like.",
    "- Keep the tone warm, promotional, and trustworthy.",
    "- Do not invent facts.",
    `Store: ${params.submission.stores?.store_name ?? "가게"}`,
    `Market: ${params.submission.stores?.market_name ?? "전통시장"}`,
    `Menu: ${params.submission.target_menu_name}`,
    `Appeal point: ${params.submission.appeal_point}`,
    params.submission.extra_message
      ? `Extra merchant note: ${params.submission.extra_message}`
      : null,
    params.merchantInsights.targetCustomer
      ? `Target customer: ${params.merchantInsights.targetCustomer}`
      : null,
    params.merchantInsights.peakSalesTime
      ? `Peak sales time: ${params.merchantInsights.peakSalesTime}`
      : null,
    publicDataFlavor ? `Verified public-data flavor: ${publicDataFlavor}` : null,
    params.festivalContext.found && params.festivalContext.verified
      ? `Verified festival cue: ${params.festivalContext.title}${formatFestivalDateRange(params.festivalContext) ? ` (${formatFestivalDateRange(params.festivalContext)})` : ""}`
      : null,
    params.weatherContext.selected_for_prompt && params.weatherContext.summary
      ? `Verified weather cue: ${params.weatherContext.summary}`
      : null,
    params.marketContext.found && params.marketContext.market_name
      ? `Verified market cue: ${params.marketContext.market_name}`
      : null,
    "[DRAFT CAPTION]",
    params.draft.caption,
    "[DRAFT HASHTAGS]",
    JSON.stringify(params.draft.hashtags),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: PROMO_CAPTION_MODEL,
        input: prompt,
      }),
      timeoutMs: 30_000,
    });

    if (!response.ok) {
      return params.draft;
    }

    const json = (await response.json()) as OpenAiResponsesResponse;
    const outputText =
      typeof json.output_text === "string" ? stripCodeFence(json.output_text) : "";

    if (!outputText) {
      return params.draft;
    }

    return normalizePromoCaptionOutput(JSON.parse(outputText), params.draft);
  } catch {
    return params.draft;
  }
}

export async function generateFoodCardNewsPlan(
  submission: SubmissionForGeneration,
): Promise<FoodCardNewsCreativePlan> {
  const fallbackPlan = buildDefaultFoodCardNewsPlan(submission);
  return fallbackPlan;
}

export async function generatePromoCaption(
  submission: SubmissionForGeneration,
): Promise<GeneratedPromoCaption> {
  const apiKey = getOpenAiApiKey();
  const captionInputContext = await buildCaptionInputContext(submission);
  const marketContext = captionInputContext.market_context;
  const weatherContext = captionInputContext.weather_context;
  const festivalContext = captionInputContext.festival_context;
  const kamisContext = captionInputContext.kamis_context;
  const tourismCorpusContext = captionInputContext.tourism_corpus_context;
  const evidence = [
    ...buildMerchantEvidenceItems(captionInputContext.merchant_context),
    ...buildMarketEvidenceItems(marketContext),
    ...buildWeatherEvidenceItems(weatherContext),
    ...buildFestivalEvidenceItems(festivalContext),
    ...buildKamisEvidenceItems(kamisContext),
    ...buildTourismCorpusEvidenceItems(tourismCorpusContext),
  ];
  const merchantInsights = readMerchantInsights(submission.ai_metadata);
  const fallback = buildCaptionFallback(
    submission,
    merchantInsights,
    marketContext,
    weatherContext,
    festivalContext,
    kamisContext,
    tourismCorpusContext,
  );
  const fallbackResult: GeneratedPromoCaption = {
    caption: fallback.caption,
    hashtags: fallback.hashtags,
    marketContext,
    weatherContext,
    festivalContext,
    kamisContext,
    tourismCorpusContext,
    captionInputContext,
    evidence,
  };

  if (!apiKey) {
    return fallbackResult;
  }

  const merchantSummary = [
    `가게명: ${captionInputContext.merchant_context.store_name ?? "미입력"}`,
    `시장명: ${captionInputContext.merchant_context.market_name ?? "미입력"}`,
    `메뉴명: ${captionInputContext.merchant_context.product}`,
    captionInputContext.merchant_context.price
      ? `가격: ${captionInputContext.merchant_context.price}`
      : null,
    `핵심 매력: ${captionInputContext.merchant_context.appeal_point}`,
    captionInputContext.merchant_context.target_customer
      ? `주 고객층: ${captionInputContext.merchant_context.target_customer}`
      : null,
    captionInputContext.merchant_context.peak_sales_time
      ? `잘 팔리는 시간: ${captionInputContext.merchant_context.peak_sales_time}`
      : null,
    captionInputContext.merchant_context.popular_menu_notes
      ? `요즘 많이 찾는 메뉴 흐름: ${captionInputContext.merchant_context.popular_menu_notes}`
      : null,
    captionInputContext.merchant_context.extra_message
      ? `추가 메모: ${captionInputContext.merchant_context.extra_message}`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n- ");

  const marketGuide = marketContext.found
    ? [
        `확인된 시장명: ${marketContext.market_name}`,
        [marketContext.province, marketContext.district].filter(Boolean).length > 0
          ? `확인된 지역: ${[marketContext.province, marketContext.district]
              .filter(Boolean)
              .join(" ")}`
          : null,
        marketContext.market_type
          ? `확인된 시장 유형: ${marketContext.market_type}`
          : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n- ")
    : "시장 공공데이터 미확인";

  const festivalGuide =
    festivalContext.found && festivalContext.verified
      ? [
          `행사명: ${festivalContext.title}`,
          festivalContext.event_start_date && festivalContext.event_end_date
            ? `행사 기간: ${festivalContext.event_start_date} ~ ${festivalContext.event_end_date}`
            : null,
          typeof festivalContext.distance_km === "number"
            ? `시장 기준 거리: ${festivalContext.distance_km}km`
            : null,
        ]
          .filter((value): value is string => Boolean(value))
          .join("\n- ")
      : "행사 데이터 미활용";

  const weatherGuide = weatherContext.selected_for_prompt
    ? [
        weatherContext.summary,
        typeof weatherContext.current?.temperature === "number"
          ? `현재 기온: ${Math.round(weatherContext.current.temperature)}도`
          : null,
        weatherContext.current?.precipitationType &&
        weatherContext.current.precipitationType !== "없음"
          ? `현재 강수: ${weatherContext.current.precipitationType}`
          : null,
        weatherContext.forecast?.sky ? `가까운 예보: ${weatherContext.forecast.sky}` : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n- ")
    : "날씨 데이터 미활용";

  const kamisGuide = kamisContext.selected_for_prompt
    ? [
        kamisContext.matched_item ? `품목: ${kamisContext.matched_item}` : null,
        kamisContext.region ? `지역: ${kamisContext.region}` : null,
        kamisContext.latest_price !== null ? "최근 가격 흐름 참고 가능" : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n- ")
    : "가격 데이터 미활용";
  const tourismCorpusGuide =
    tourismCorpusContext.selected_for_prompt && tourismCorpusContext.examples.length > 0
      ? tourismCorpusContext.examples
          .slice(0, 3)
          .map(
            (example) =>
              `${example.place_name} (${example.category}) - ${example.excerpt.slice(0, 120)}`,
          )
          .join("\n- ")
      : "관광 말뭉치 미활용";

  const prompt = [
    "You are writing a Korean Instagram caption for a traditional-market food merchant.",
    "Your job is to turn merchant facts into a short, publishable Korean promotional caption, not a flat summary.",
    "Return strict JSON only with keys: caption, hashtags.",
    "Caption rules:",
    "- Write in Korean.",
    "- Write 3 to 4 sentences.",
    "- Sentence 1 should make the menu feel appetizing or immediately interesting.",
    "- Sentence 2 should clearly reflect the merchant's direct selling point.",
    "- Sentence 3 may reflect customer group, time-of-day demand, weather context, market context, or nearby festival context only when verified and useful.",
    "- Final sentence should softly encourage a visit or make the store/menu feel easy to remember.",
    "- Sound warm, trustworthy, and appetizing.",
    "- Make it feel like a real small-business Instagram ad that can be posted today.",
    "- Avoid flat summary style and avoid mechanically repeating field labels.",
    "- Do not copy input labels such as '주력 메뉴를 포함한 대표 메뉴 소개' or '가게만의 특별함'.",
    "- Prefer concise, punchy, concrete Korean wording over report-like phrasing.",
    "- It is okay to omit minor facts to keep the ad attractive.",
    "- Do not try to include every merchant fact. Select only the 1 or 2 most important selling points for the ad.",
    "- If multiple merchant facts exist, prioritize menu appeal first, then one supporting point such as specialty, target customer, timing, or local context.",
    "- Omit less important details instead of forcing everything into the caption.",
    "- Do not invent facts that were not provided.",
    "- Reflect the merchant's target customer and peak sales timing naturally if useful.",
    "- [MERCHANT FACT] is the source of truth for menu, price, appeal point, packaging, cooking, and current sales details.",
    "- [WEATHER PUBLIC DATA] may only be used for verified current weather or near-term forecast context when weather_context.selected_for_prompt=true.",
    "- [MARKET PUBLIC DATA] may only be used for verified market name, region, road address, and facility facts when found=true.",
    "- [FESTIVAL PUBLIC DATA] may only be used for verified festival title, event dates, event address, and distance when found=true and verified=true.",
    "- [KAMIS PUBLIC DATA] may only be used as auxiliary price-market context when kamis_context.selected_for_prompt=true.",
    "- [TOURISM CORPUS REFERENCE] is style-only reference for regional promotional tone, never factual merchant evidence.",
    "- If weather_context.selected_for_prompt is false, do not add any weather public-data facts.",
    "- If market_context.found is false, do not add any market public-data facts.",
    "- If festival_context.found is false or festival_context.verified is not true, do not add any festival public-data facts.",
    "- If kamis_context.selected_for_prompt is false, do not add any KAMIS public-data facts.",
    "- If tourism_corpus_context.selected_for_prompt is false, do not use tourism corpus references.",
    "- If a facility value is false or null, do not mention that facility.",
    "- Never infer popularity, rankings, tourism, reputation, or visitor volume from market_context.",
    "- Never claim the merchant is officially linked to a festival, is the festival's official 맛집, or is popular because of the festival.",
    "- Festival information should only be used as nearby timing/location context when it naturally helps the caption.",
    "- Weather information should only be used as visit timing or menu mood context. Never claim exact business performance from weather.",
    "- KAMIS public data must never override the merchant's actual selling price.",
    "- Do not claim cheaper than market, best price, lowest price, or value superiority from KAMIS data.",
    "- KAMIS should only help decide whether explicit price exposure or freshness/current-price context is meaningful.",
    "- Tourism corpus may inspire sentence texture, rhythm, and local travel mood only.",
    "- Never copy tourism place names, addresses, phone numbers, opening hours, or facilities into the merchant caption.",
    "- Never present tourism corpus text as if it were true for this merchant unless separately verified.",
    "- Do not use excessive emojis. At most 1 emoji.",
    "- Do not use empty ad clichés such as '깊은 풍미', '특별한 경험', '맛의 진수', '정성을 담아'.",
    "- Prefer concrete everyday Korean wording that sounds like a good local 홍보 글.",
    "Hashtag rules:",
    "- Return 3 to 5 Korean hashtags.",
    "- Include menu/store/market-related tags when natural.",
    "- Make hashtags look like real discovery hashtags people might search on Instagram.",
    "- Prefer a varied mix such as market, store, menu, occasion, district, or use-case hashtags.",
    "- Each hashtag string must start with #.",
    "[WRITING PRIORITY]",
    "- Merchant facts come first.",
    "- Public data only strengthens location or timing context after merchant facts are already reflected.",
    "- If no public data is usable, still write a strong caption from merchant facts alone.",
    "[MERCHANT SUMMARY]",
    `- ${merchantSummary}`,
    "[MARKET USAGE GUIDE]",
    `- ${marketGuide}`,
    "[WEATHER USAGE GUIDE]",
    `- ${weatherGuide}`,
    "[FESTIVAL USAGE GUIDE]",
    `- ${festivalGuide}`,
    "[KAMIS USAGE GUIDE]",
    `- ${kamisGuide}`,
    "[TOURISM CORPUS USAGE GUIDE]",
    `- ${tourismCorpusGuide}`,
    "[MERCHANT FACT]",
    JSON.stringify(captionInputContext.merchant_context, null, 2),
    "[MARKET PUBLIC DATA]",
    JSON.stringify(captionInputContext.market_context, null, 2),
    "[WEATHER PUBLIC DATA]",
    JSON.stringify(captionInputContext.weather_context, null, 2),
    "[FESTIVAL PUBLIC DATA]",
    JSON.stringify(captionInputContext.festival_context, null, 2),
    "[KAMIS PUBLIC DATA]",
    JSON.stringify(captionInputContext.kamis_context, null, 2),
    "[TOURISM CORPUS REFERENCE]",
    JSON.stringify(captionInputContext.tourism_corpus_context, null, 2),
    "[SELECTED CONTEXT]",
    JSON.stringify(captionInputContext.selected_context, null, 2),
    "[SELECTION REASON]",
    JSON.stringify(captionInputContext.selection_reason, null, 2),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: PROMO_CAPTION_MODEL,
        input: prompt,
      }),
      timeoutMs: 30_000,
    });

    if (!response.ok) {
      return fallbackResult;
    }

    const json = (await response.json()) as OpenAiResponsesResponse;
    const outputText =
      typeof json.output_text === "string" ? stripCodeFence(json.output_text) : "";

    if (!outputText) {
      return fallbackResult;
    }

    const firstPass = normalizePromoCaptionOutput(
      JSON.parse(outputText),
      {
        caption: fallbackResult.caption,
        hashtags: fallbackResult.hashtags,
      },
    );
    const finalCopy = await reviewPromoCaptionDraft({
      apiKey,
      submission,
      merchantInsights,
      draft: firstPass,
      marketContext,
      weatherContext,
      festivalContext,
      kamisContext,
      tourismCorpusContext,
    });

    return {
      caption: finalCopy.caption,
      hashtags: finalCopy.hashtags,
      marketContext,
      weatherContext,
      festivalContext,
      kamisContext,
      tourismCorpusContext,
      captionInputContext,
      evidence,
    };
  } catch {
    return fallbackResult;
  }
}

export function buildPromoPrompt(
  submission: SubmissionForGeneration,
  stylePreset: GenerationStylePreset,
) {
  const storeName = submission.stores?.store_name ?? "가게";
  const marketName = submission.stores?.market_name ?? "전통시장";
  const ownerName = submission.stores?.owner_name ?? submission.store_type;
  const merchantInsights = readMerchantInsights(submission.ai_metadata);
  const foodProfile = inferFoodVisualProfile(
    submission.store_type,
    submission.target_menu_name,
  );

  const sharedContext = [
    "Create a polished Korean mobile food advertisement poster for a real traditional-market merchant.",
    "The output should look like a premium social-media ad designed by an experienced food marketing art director, not a generic AI flyer.",
    `Market: ${marketName}`,
    `Store: ${storeName}`,
    `Owner reference: ${ownerName}`,
    `Store type: ${submission.store_type}`,
    `Featured menu: ${submission.target_menu_name}`,
    submission.price_text ? `Price text: ${submission.price_text}` : null,
    `Appeal point: ${submission.appeal_point}`,
    merchantInsights.targetCustomer
      ? `Main customer group: ${merchantInsights.targetCustomer}`
      : null,
    merchantInsights.peakSalesTime
      ? `Best-selling time or occasion: ${merchantInsights.peakSalesTime}`
      : null,
    merchantInsights.popularMenuNotes
      ? `Popular customer demand: ${merchantInsights.popularMenuNotes}`
      : null,
    submission.extra_message
      ? `Extra message from merchant: ${submission.extra_message}`
      : null,
    submission.caption ? `Suggested caption: ${submission.caption}` : null,
    "Primary goal: make the food look irresistibly delicious at first glance while preserving a trustworthy local-market identity.",
    "Do not stuff every merchant fact into the ad. Select only the most important selling points that make the poster feel clean and memorable.",
    "Prefer one hero message about the menu, plus at most one supporting message about specialty, mood, customer fit, or local context.",
    "Preserve a realistic, minimally edited feeling so the final result stays close to the merchant's original uploaded photos.",
    "Prefer believable compositions, real-world camera angles, and natural details that could be achieved from the merchant's own source photos.",
    "Design for a Korean mobile audience and a vertical or 4:5 social promo card.",
    "Use elegant Korean promotional typography space with very short text only.",
    "If text appears inside the image, keep it minimal, bold, legible, and naturally integrated.",
    "Prefer one strong headline area, one menu or price emphasis area, and one clear hero image.",
    "Use realistic food styling, sharp detail, appetizing gloss, natural steam when appropriate, and believable plating.",
    `Food category: ${foodProfile.category}`,
    `Hero focus: ${foodProfile.heroFocus}`,
    `Food styling direction: ${foodProfile.stylingDirection}`,
    `Background direction: ${foodProfile.backgroundDirection}`,
    `Color direction: ${foodProfile.colorDirection}`,
    "Avoid clutter, cheap flyer aesthetics, random stickers, too many badges, tiny unreadable text, awkward hands, distorted cutlery, duplicated food pieces, watermarks, logos, fake QR codes, app UI, collage chaos, and stock-template vibes.",
    buildShortCopyGuidance(submission, merchantInsights),
  ]
    .filter(Boolean)
    .join("\n");

  if (stylePreset === "menu_highlight") {
    return `${sharedContext}

Visual direction:
- Hero-shot centered on the featured menu with a tight, appetizing composition.
- Warm tungsten market lighting with rich contrast and crisp texture.
- Premium but approachable tone, as if made for a viral local food promotion.
- Food in sharp focus, background softly blurred for clean depth separation.
- Add subtle market cues only in the background, never distracting from the dish.
- Favor bold composition, confident whitespace, and a refined dark-to-warm color balance.
- The result should feel expensive, modern, and highly clickable on a smartphone feed.`;
  }

  if (stylePreset === "market_story") {
    return `${sharedContext}

Visual direction:
- Blend the food with a tasteful traditional-market atmosphere.
- Human, lively, authentic neighborhood storytelling tone.
- Suggest a real place with warmth, evening glow, and local energy.
- Include environmental hints such as stall lighting, side dishes, trays, or signage blur only if they elevate realism.
- Make it feel like a beloved hidden gem people would want to save and share.
- Keep the poster stylish and cinematic rather than documentary or messy.`;
  }

  if (stylePreset === "food_card_news") {
    const firstCard = buildFoodCardNewsPrompts(submission)[0];

    return firstCard?.prompt ?? sharedContext;
  }

  return `${sharedContext}

Visual direction:
- Clean editorial poster style with strong hierarchy.
- Minimal clutter, modern premium layout, and soft background separation.
- Bright but tasteful palette, balanced contrast, and premium food-photography finish.
- Suitable for a merchant-facing ad preview that already feels close to publishable.
- Make the composition feel intentional, contemporary, and brand-safe.`;
}

export function choosePromoImageCount(
  submission: SubmissionForGeneration,
  stylePreset: GenerationStylePreset,
) {
  if (stylePreset === "food_card_news") {
    return 3;
  }

  const merchantInsights = readMerchantInsights(submission.ai_metadata);

  let count = 5;

  if (stylePreset === "market_story") {
    count += 1;
  }

  if (submission.extra_message || merchantInsights.popularMenuNotes) {
    count += 1;
  }

  return Math.min(7, Math.max(5, count));
}

export function buildPromoCarouselPrompts(
  submission: SubmissionForGeneration,
  stylePreset: GenerationStylePreset,
  options?: {
    foodCardNewsPlan?: FoodCardNewsCreativePlan | null;
  },
) {
  if (stylePreset === "food_card_news") {
    return buildFoodCardNewsPrompts(
      submission,
      options?.foodCardNewsPlan ?? null,
    ).map((card) => ({
      index: card.index,
      key: card.key,
      prompt: card.prompt,
    }));
  }

  const merchantInsights = readMerchantInsights(submission.ai_metadata);
  const basePrompt = buildPromoPrompt(submission, stylePreset);
  const variants: PromoCarouselVariant[] = [
    {
      key: "hero",
      instruction:
        "Slide focus: create the strongest hero image for the featured menu. Make the dish immediately craveable and premium.",
    },
    {
      key: "detail",
      instruction:
        "Slide focus: a tighter macro-style composition emphasizing texture, steam, gloss, and ingredient detail.",
    },
    {
      key: "price",
      instruction: submission.price_text
        ? `Slide focus: naturally support price/value communication for ${submission.price_text} without making the image look like a cheap flyer.`
        : "Slide focus: emphasize value and satisfaction without inventing or displaying a price.",
    },
    {
      key: "audience",
      instruction: merchantInsights.targetCustomer || merchantInsights.peakSalesTime
        ? `Slide focus: subtly reflect the real customer context and buying timing. Audience: ${merchantInsights.targetCustomer ?? "손님"}. Timing: ${merchantInsights.peakSalesTime ?? "방문 시간대"}.`
        : "Slide focus: make the dish feel broadly appealing to everyday local customers.",
    },
    {
      key: "market_story",
      instruction:
        "Slide focus: blend the food with tasteful traditional-market atmosphere and authentic neighborhood warmth.",
    },
    {
      key: "popular_demand",
      instruction: merchantInsights.popularMenuNotes
        ? `Slide focus: visually reinforce why customers keep choosing it. Popular demand hint: ${merchantInsights.popularMenuNotes}.`
        : "Slide focus: present the menu as a proven favorite and trustworthy best-seller.",
    },
    {
      key: "cta",
      instruction:
        "Slide focus: clean closing image suitable for the final carousel card, with confident whitespace and a subtle call-to-action mood.",
    },
  ];

  const imageCount = choosePromoImageCount(submission, stylePreset);

  return variants.slice(0, imageCount).map((variant, index) => ({
    index,
    key: variant.key,
    prompt: `${basePrompt}

Carousel slide ${index + 1} of ${imageCount}.
${variant.instruction}
Make this slide visually distinct from the others while keeping the same merchant, dish, and campaign identity.`,
  }));
}

export function validateStylePresetForSubmission(
  submission: SubmissionForGeneration,
  stylePreset: GenerationStylePreset,
) {
  if (stylePreset !== "food_card_news") {
    return {
      ok: true as const,
    };
  }

  if (!isFoodCardNewsEligible(submission)) {
    return {
      ok: false as const,
      reason:
        "food_card_news style preset is only supported for food-related submissions",
    };
  }

  return {
    ok: true as const,
  };
}

async function fetchImageBytesFromUrl(url: string) {
  const response = await fetchWithTimeout(url, {
    timeoutMs: 60_000,
  });

  if (!response.ok) {
    throw new Error(`Failed to download generated image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  return Buffer.from(arrayBuffer);
}

export async function generatePromoImage(params: {
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
  timeoutMs?: number;
}) {
  const apiKey = getOpenAiApiKey();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetchWithTimeout("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model ?? DEFAULT_IMAGE_MODEL,
      prompt: params.prompt,
      size: params.size ?? DEFAULT_IMAGE_SIZE,
      quality: params.quality ?? DEFAULT_IMAGE_QUALITY,
      background: "auto",
      output_format: "png",
    }),
    timeoutMs: params.timeoutMs ?? 120_000,
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(`OpenAI image generation failed: ${errorText}`);
  }

  const payload = (await response.json()) as OpenAiImageResponse;
  const firstImage = payload.data?.[0];

  if (!firstImage) {
    throw new Error("OpenAI image generation returned no image");
  }

  if (firstImage.b64_json) {
    return {
      bytes: Buffer.from(firstImage.b64_json, "base64"),
      revisedPrompt: firstImage.revised_prompt ?? null,
    };
  }

  if (firstImage.url) {
    const bytes = await fetchImageBytesFromUrl(firstImage.url);

    return {
      bytes,
      revisedPrompt: firstImage.revised_prompt ?? null,
    };
  }

  throw new Error("OpenAI image generation response did not include image data");
}
