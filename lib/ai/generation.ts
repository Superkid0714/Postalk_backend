import { getOpenAiApiKey } from "@/lib/env";

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
  | "market_story";

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

type MerchantInsights = {
  targetCustomer: string | null;
  peakSalesTime: string | null;
  popularMenuNotes: string | null;
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

  return `${sharedContext}

Visual direction:
- Clean editorial poster style with strong hierarchy.
- Minimal clutter, modern premium layout, and soft background separation.
- Bright but tasteful palette, balanced contrast, and premium food-photography finish.
- Suitable for a merchant-facing ad preview that already feels close to publishable.
- Make the composition feel intentional, contemporary, and brand-safe.`;
}

async function fetchImageBytesFromUrl(url: string) {
  const response = await fetch(url);

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

  const response = await fetch("https://api.openai.com/v1/images/generations", {
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
