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
  type CaptionInputContext,
} from "@/lib/ai/context";
import { fetchWithTimeout } from "@/lib/http";
import type { KamisContext } from "@/lib/public-data/kamis";
import type { FestivalContext } from "@/lib/public-data/tour-festival";
import type {
  CaptionEvidenceItem,
  MarketContext,
} from "@/lib/public-data/traditional-market";

const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_IMAGE_SIZE = "1536x1024";
const DEFAULT_IMAGE_QUALITY = "medium";

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
  if (Array.isArray(stores)) {
    return (stores[0] as SubmissionForGeneration["stores"]) ?? null;
  }

  return (stores as SubmissionForGeneration["stores"]) ?? null;
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
  festivalContext: FestivalContext;
  kamisContext: KamisContext;
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

function buildCaptionFallback(
  submission: SubmissionForGeneration,
  merchantInsights: MerchantInsights,
  marketContext?: MarketContext | null,
  festivalContext?: FestivalContext | null,
  kamisContext?: KamisContext | null,
){
  const intro = `${submission.target_menu_name}${merchantInsights.peakSalesTime ? ` ${merchantInsights.peakSalesTime}` : ""}에 더 눈길이 가는 메뉴입니다.`;
  const appealSentence = submission.appeal_point
    ? `${submission.appeal_point} 매력이 분명해서 한 끼 메뉴로 가볍게 고르기 좋습니다.`
    : null;
  const contextSentence =
    merchantInsights.targetCustomer
      ? `${merchantInsights.targetCustomer} 손님들이 자주 찾는 흐름을 자연스럽게 담았습니다.`
      : marketContext?.found && marketContext.market_name
        ? `${marketContext.market_name}${marketContext.district ? ` ${marketContext.district}` : ""} 분위기 속에서 편하게 떠올리기 좋은 메뉴입니다.`
        : festivalContext?.found && festivalContext.verified && festivalContext.title
          ? `${festivalContext.title} 일정 전후로 근처에서 들르기 좋은 한 끼 흐름으로도 연결할 수 있습니다.`
          : kamisContext?.selected_for_prompt && kamisContext.region
            ? `${kamisContext.region} 기준 장바구니 물가 흐름을 참고해도 일상적으로 매력 있게 다가갈 수 있는 메뉴입니다.`
            : null;
  const closingSentence = submission.extra_message
    ? submission.extra_message.endsWith(".")
      ? submission.extra_message
      : `${submission.extra_message}.`
    : `${submission.target_menu_name} 생각날 때 부담 없이 찾을 수 있는 메뉴 톤으로 정리했습니다.`;

  const caption = [
    intro,
    appealSentence,
    contextSentence,
    closingSentence,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");

  const hashtags = [
    submission.stores?.market_name ? `#${submission.stores.market_name.replace(/\s+/g, "")}` : null,
    submission.stores?.store_name ? `#${submission.stores.store_name.replace(/\s+/g, "")}` : null,
    `#${submission.target_menu_name.replace(/\s+/g, "")}`,
  ].filter((value): value is string => Boolean(value));

  return {
    caption,
    hashtags,
  };
}

function stripCodeFence(value: string) {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
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
  const festivalContext = captionInputContext.festival_context;
  const kamisContext = captionInputContext.kamis_context;
  const evidence = [
    ...buildMerchantEvidenceItems(captionInputContext.merchant_context),
    ...buildMarketEvidenceItems(marketContext),
    ...buildFestivalEvidenceItems(festivalContext),
    ...buildKamisEvidenceItems(kamisContext),
  ];
  const merchantInsights = readMerchantInsights(submission.ai_metadata);
  const fallback = buildCaptionFallback(
    submission,
    merchantInsights,
    marketContext,
    festivalContext,
    kamisContext,
  );
  const fallbackResult: GeneratedPromoCaption = {
    caption: fallback.caption,
    hashtags: fallback.hashtags,
    marketContext,
    festivalContext,
    kamisContext,
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

  const kamisGuide = kamisContext.selected_for_prompt
    ? [
        kamisContext.matched_item ? `품목: ${kamisContext.matched_item}` : null,
        kamisContext.region ? `지역: ${kamisContext.region}` : null,
        kamisContext.latest_price !== null ? "최근 가격 흐름 참고 가능" : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n- ")
    : "가격 데이터 미활용";

  const prompt = [
    "You are writing a Korean Instagram caption for a traditional-market food merchant.",
    "Your job is to turn merchant facts into a short, publishable Korean promotional caption, not a flat summary.",
    "Return strict JSON only with keys: caption, hashtags.",
    "Caption rules:",
    "- Write in Korean.",
    "- Write 3 to 4 sentences.",
    "- Sentence 1 should make the menu feel appetizing or immediately interesting.",
    "- Sentence 2 should clearly reflect the merchant's direct selling point.",
    "- Sentence 3 may reflect customer group, time-of-day demand, market context, or nearby festival context only when verified and useful.",
    "- Final sentence should softly encourage a visit or make the store/menu feel easy to remember.",
    "- Sound warm, trustworthy, and appetizing.",
    "- Avoid flat summary style and avoid mechanically repeating field labels.",
    "- Do not invent facts that were not provided.",
    "- Reflect the merchant's target customer and peak sales timing naturally if useful.",
    "- [MERCHANT FACT] is the source of truth for menu, price, appeal point, packaging, cooking, and current sales details.",
    "- [MARKET PUBLIC DATA] may only be used for verified market name, region, road address, and facility facts when found=true.",
    "- [FESTIVAL PUBLIC DATA] may only be used for verified festival title, event dates, event address, and distance when found=true and verified=true.",
    "- [KAMIS PUBLIC DATA] may only be used as auxiliary price-market context when kamis_context.selected_for_prompt=true.",
    "- If market_context.found is false, do not add any market public-data facts.",
    "- If festival_context.found is false or festival_context.verified is not true, do not add any festival public-data facts.",
    "- If kamis_context.selected_for_prompt is false, do not add any KAMIS public-data facts.",
    "- If a facility value is false or null, do not mention that facility.",
    "- Never infer popularity, rankings, tourism, reputation, or visitor volume from market_context.",
    "- Never claim the merchant is officially linked to a festival, is the festival's official 맛집, or is popular because of the festival.",
    "- Festival information should only be used as nearby timing/location context when it naturally helps the caption.",
    "- KAMIS public data must never override the merchant's actual selling price.",
    "- Do not claim cheaper than market, best price, lowest price, or value superiority from KAMIS data.",
    "- KAMIS should only help decide whether explicit price exposure or freshness/current-price context is meaningful.",
    "- Do not use excessive emojis. At most 1 emoji.",
    "- Do not use empty ad clichés such as '깊은 풍미', '특별한 경험', '맛의 진수', '정성을 담아'.",
    "- Prefer concrete everyday Korean wording that sounds like a good local 홍보 글.",
    "Hashtag rules:",
    "- Return 3 to 5 Korean hashtags.",
    "- Include menu/store/market-related tags when natural.",
    "- Each hashtag string must start with #.",
    "[WRITING PRIORITY]",
    "- Merchant facts come first.",
    "- Public data only strengthens location or timing context after merchant facts are already reflected.",
    "- If no public data is usable, still write a strong caption from merchant facts alone.",
    "[MERCHANT SUMMARY]",
    `- ${merchantSummary}`,
    "[MARKET USAGE GUIDE]",
    `- ${marketGuide}`,
    "[FESTIVAL USAGE GUIDE]",
    `- ${festivalGuide}`,
    "[KAMIS USAGE GUIDE]",
    `- ${kamisGuide}`,
    "[MERCHANT FACT]",
    JSON.stringify(captionInputContext.merchant_context, null, 2),
    "[MARKET PUBLIC DATA]",
    JSON.stringify(captionInputContext.market_context, null, 2),
    "[FESTIVAL PUBLIC DATA]",
    JSON.stringify(captionInputContext.festival_context, null, 2),
    "[KAMIS PUBLIC DATA]",
    JSON.stringify(captionInputContext.kamis_context, null, 2),
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
        model: "gpt-4.1-mini",
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

    const parsed = JSON.parse(outputText) as {
      caption?: unknown;
      hashtags?: unknown;
    };

    const caption =
      typeof parsed.caption === "string" && parsed.caption.trim().length > 0
        ? parsed.caption.trim()
        : fallbackResult.caption;
    const hashtags = Array.isArray(parsed.hashtags)
      ? parsed.hashtags
          .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
          .map((tag) => (tag.startsWith("#") ? tag.trim() : `#${tag.trim()}`))
          .slice(0, 5)
      : fallbackResult.hashtags;

    return {
      caption,
      hashtags: hashtags.length > 0 ? hashtags : fallbackResult.hashtags,
      marketContext,
      festivalContext,
      kamisContext,
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
    return 5;
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
    timeoutMs: 120_000,
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
