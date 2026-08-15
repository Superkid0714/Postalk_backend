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
  price_text: string;
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

export function buildPromoPrompt(
  submission: SubmissionForGeneration,
  stylePreset: GenerationStylePreset,
) {
  const storeName = submission.stores?.store_name ?? "가게";
  const marketName = submission.stores?.market_name ?? "전통시장";
  const ownerName = submission.stores?.owner_name ?? submission.store_type;

  const sharedContext = [
    "Create a Korean mobile promotional poster image for a traditional market merchant.",
    `Market: ${marketName}`,
    `Store: ${storeName}`,
    `Owner reference: ${ownerName}`,
    `Store type: ${submission.store_type}`,
    `Featured menu: ${submission.target_menu_name}`,
    `Price text: ${submission.price_text}`,
    `Appeal point: ${submission.appeal_point}`,
    submission.extra_message
      ? `Extra message from merchant: ${submission.extra_message}`
      : null,
    submission.caption ? `Suggested caption: ${submission.caption}` : null,
    "Keep the poster clean, readable, appetizing, and suitable for a Korean local-market promotion.",
    "Use Korean typography space intentionally and leave room for overlay text.",
    "Do not add watermarks, UI chrome, app screens, logos, or fake QR codes.",
  ]
    .filter(Boolean)
    .join("\n");

  if (stylePreset === "menu_highlight") {
    return `${sharedContext}

Visual direction:
- Focus strongly on the featured food.
- Warm market lighting, realistic food texture, premium but approachable.
- Composition should prioritize the dish and a compact promo-layout feeling.
- Poster ratio should fit a smartphone feed card.`;
  }

  if (stylePreset === "market_story") {
    return `${sharedContext}

Visual direction:
- Blend the food with a subtle traditional market atmosphere.
- Human, lively, authentic, neighborhood storytelling tone.
- Make it feel like a local hidden gem that deserves attention.`;
  }

  return `${sharedContext}

Visual direction:
- Clean poster style with clear hierarchy.
- Minimal clutter, modern promotional layout, soft background separation.
- Suitable for a merchant-facing MVP ad preview.`;
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
