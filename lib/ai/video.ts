import { getGeminiApiKey, getGeminiVideoModel } from "@/lib/env";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_VIDEO_MODEL = "veo-3.1-generate-preview";

export type VideoAspectRatio = "9:16" | "16:9";
export type VideoResolution = "720p" | "1080p";
export type VideoDurationSeconds = 4 | 6 | 8;
export type VideoStylePreset = "market_story" | "food_closeup" | "premium";

export type VideoReferenceImage = {
  mimeType: string;
  bytesBase64: string;
};

export type VideoGenerationScript = {
  hookText: string;
  scenes: Array<{
    order: number;
    text: string;
    focus: "store_intro" | "food_highlight" | "price_cta";
  }>;
  caption: string;
  hashtags: string[];
};

export type SubmissionForVideoPrompt = {
  storeName: string;
  marketName: string;
  storeType: string;
  targetMenuName: string;
  priceText: string | null;
  appealPoint: string;
  extraMessage: string | null;
  targetCustomer?: string | null;
  peakSalesTime?: string | null;
  popularMenuNotes?: string | null;
};

type VideoFoodProfile = {
  category: string;
  openingShot: string;
  motionStyle: string;
  detailFocus: string;
  endingShot: string;
  colorMood: string;
};

function getVideoModel() {
  return getGeminiVideoModel() ?? DEFAULT_VIDEO_MODEL;
}

function getRequiredGeminiApiKey() {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  return apiKey;
}

function inferVideoFoodProfile(
  storeType: string,
  targetMenuName: string,
): VideoFoodProfile {
  const source = `${storeType} ${targetMenuName}`.toLowerCase();

  if (/회|초밥|스시|해산물|fish|sashimi|sushi/.test(source)) {
    return {
      category: "seafood",
      openingShot: "clean premium reveal of the plated seafood with crisp freshness",
      motionStyle: "slow push-in and gentle lateral pan",
      detailFocus: "knife-cut texture, moist highlights, garnish detail, premium freshness",
      endingShot: "elegant hero hold with concise brand or menu emphasis",
      colorMood: "cool clean highlights with restrained wood and green accents",
    };
  }

  if (/국밥|탕|찌개|전골|라면|우동|칼국수|국수|soup|noodle/.test(source)) {
    return {
      category: "hot_soup",
      openingShot: "steam-heavy reveal from the bowl surface",
      motionStyle: "slow push-in with subtle steam movement and bowl orbit",
      detailFocus: "broth depth, noodles or toppings lifting, warmth and comfort",
      endingShot: "comforting hero hold with warm call-to-action",
      colorMood: "warm amber highlights with cozy contrast",
    };
  }

  if (/치킨|튀김|돈까스|fried|cutlet/.test(source)) {
    return {
      category: "fried",
      openingShot: "high-impact crunchy close-up with bold texture",
      motionStyle: "snappy macro reveal followed by a smooth hero lock",
      detailFocus: "golden crust, crunch texture, juicy interior, seasoning detail",
      endingShot: "confident product close with energetic payoff",
      colorMood: "deep warm contrast with glossy golden highlights",
    };
  }

  if (/고기|갈비|삼겹|불고기|족발|보쌈|barbecue|meat/.test(source)) {
    return {
      category: "meat",
      openingShot: "rich savory reveal with char and glaze",
      motionStyle: "cinematic push-in and slow drift across the meat surface",
      detailFocus: "grill marks, glaze, juicy fibers, smoke or heat",
      endingShot: "luxurious hero frame with premium food-commercial finish",
      colorMood: "bronze, deep brown, and warm smoky highlights",
    };
  }

  return {
    category: "general_food",
    openingShot: "strong appetizing hero reveal of the featured dish",
    motionStyle: "smooth premium short-form ad camera movement",
    detailFocus: "texture, freshness, serving size, and believable appeal",
    endingShot: "clean hero hold with short call-to-action finish",
    colorMood: "balanced warm palette with modern contrast",
  };
}

export function buildVideoPrompt(
  submission: SubmissionForVideoPrompt,
  stylePreset: VideoStylePreset,
) {
  const foodProfile = inferVideoFoodProfile(
    submission.storeType,
    submission.targetMenuName,
  );
  const styleDirection =
    stylePreset === "premium"
      ? "Cinematic, polished, premium food commercial look with crisp lighting, confident camera movement, and a luxury short-form ad finish."
      : stylePreset === "food_closeup"
        ? "Tight closeups of the food, appetizing texture, steam, glossy highlights, shallow depth of field, and energetic short-form food ad pacing."
        : "Warm Korean traditional-market storytelling tone, lively yet clean, neighborhood charm, cinematic but not messy.";

  return [
    "Create a vertical 9:16 Korean short-form food advertisement video.",
    "Duration: exactly 8 seconds.",
    "Use the provided food image as strong visual guidance.",
    "The result must feel like a polished mobile ad for a real Korean market merchant, not a rough AI montage.",
    `Market: ${submission.marketName}`,
    `Store: ${submission.storeName}`,
    `Store type: ${submission.storeType}`,
    `Featured menu: ${submission.targetMenuName}`,
    submission.priceText ? `Price text: ${submission.priceText}` : null,
    `Appeal point: ${submission.appealPoint}`,
    submission.targetCustomer
      ? `Main customer group: ${submission.targetCustomer}`
      : null,
    submission.peakSalesTime
      ? `Best-selling time or occasion: ${submission.peakSalesTime}`
      : null,
    submission.popularMenuNotes
      ? `Popular customer demand: ${submission.popularMenuNotes}`
      : null,
    submission.extraMessage
      ? `Extra merchant note: ${submission.extraMessage}`
      : null,
    "Narrative structure: 0-2 seconds hook, 2-6 seconds food beauty and atmosphere, 6-8 seconds clean price or call-to-action finish.",
    `Food category: ${foodProfile.category}`,
    `Opening shot direction: ${foodProfile.openingShot}`,
    `Motion direction: ${foodProfile.motionStyle}`,
    `Detail focus: ${foodProfile.detailFocus}`,
    `Ending shot direction: ${foodProfile.endingShot}`,
    `Color mood: ${foodProfile.colorMood}`,
    "Show the food clearly and attractively with believable texture, gloss, steam, and natural movement.",
    "Keep camera motion smooth and intentional: slow push-in, gentle pan, macro reveal, or clean hero hold.",
    "Add only subtle Korean ad-style on-screen text, and keep it short, bold, and readable.",
    "Use at most one short headline at the opening and one short price or CTA phrase at the ending.",
    "Do not overload the frame with text, captions, or subtitles.",
    "Keep the video visually coherent and elegant for an 8-second promotional reel.",
    "Avoid chaotic editing, excessive transitions, meme energy, random props, deformed utensils, awkward hands, fake restaurant interiors, logos, app UI, fake QR codes, watermarks, unrelated subtitles, or unreadable clutter.",
    `Visual direction: ${styleDirection}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildVideoScript(
  submission: SubmissionForVideoPrompt,
  stylePreset: VideoStylePreset,
): VideoGenerationScript {
  const foodProfile = inferVideoFoodProfile(
    submission.storeType,
    submission.targetMenuName,
  );
  const hookText =
    stylePreset === "premium"
      ? `${submission.targetMenuName}, 오늘 더 특별하게`
      : `${submission.storeName} 인기 메뉴`;

  return {
    hookText,
    scenes: [
      {
        order: 1,
        text:
          stylePreset === "market_story"
            ? `${submission.storeName} 추천 메뉴`
            : `${submission.storeName} 대표 메뉴`,
        focus: "store_intro",
      },
      {
        order: 2,
        text:
          submission.appealPoint.length > 24
            ? `${submission.targetMenuName}의 진한 매력`
            : submission.appealPoint,
        focus: "food_highlight",
      },
      {
        order: 3,
        text: submission.priceText
          ? `${submission.targetMenuName} ${submission.priceText}`
          : submission.targetMenuName,
        focus: "price_cta",
      },
    ],
    caption: `${submission.targetMenuName} 어떠세요? ${submission.appealPoint} ${foodProfile.detailFocus}`,
    hashtags: [
      `#${submission.marketName.replace(/\s+/g, "")}`,
      `#${submission.storeName.replace(/\s+/g, "")}`,
      `#${submission.targetMenuName.replace(/\s+/g, "")}`,
    ],
  };
}

export async function startGeminiVideoOperation(params: {
  prompt: string;
  image?: VideoReferenceImage | null;
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  durationSeconds: VideoDurationSeconds;
}) {
  const apiKey = getRequiredGeminiApiKey();
  const model = getVideoModel();

  const sendRequest = async (includeImage: boolean) => {
    const instance: Record<string, unknown> = {
      prompt: params.prompt,
    };

    if (includeImage && params.image) {
      instance.image = {
        inlineData: {
          mimeType: params.image.mimeType,
          data: params.image.bytesBase64,
        },
      };
    }

    return fetch(`${GEMINI_BASE_URL}/models/${model}:predictLongRunning`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [instance],
        parameters: {
          aspectRatio: params.aspectRatio,
          resolution: params.resolution,
          durationSeconds: params.durationSeconds,
        },
      }),
    });
  };

  let response = await sendRequest(Boolean(params.image));

  if (!response.ok) {
    const errorText = await response.text();

    if (
      params.image &&
      errorText.includes("inlineData") &&
      errorText.includes("isn't supported")
    ) {
      response = await sendRequest(false);
    } else {
      throw new Error(`Gemini video start failed: ${errorText}`);
    }
  }

  if (!response.ok) {
    throw new Error(`Gemini video start failed: ${await response.text()}`);
  }

  return (await response.json()) as {
    name: string;
    done?: boolean;
  };
}

export async function getGeminiVideoOperation(operationName: string) {
  const apiKey = getRequiredGeminiApiKey();
  const response = await fetch(`${GEMINI_BASE_URL}/${operationName}`, {
    headers: {
      "x-goog-api-key": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Gemini video status failed: ${await response.text()}`);
  }

  return (await response.json()) as {
    name: string;
    done?: boolean;
    error?: {
      code?: number;
      message?: string;
    };
    response?: {
      generatedVideos?: Array<{
        video?: {
          uri?: string;
          mimeType?: string;
        };
      }>;
      generateVideoResponse?: {
        generatedSamples?: Array<{
          video?: {
            uri?: string;
            mimeType?: string;
          };
        }>;
      };
    };
  };
}

export function extractGeneratedVideoFile(operation: Awaited<
  ReturnType<typeof getGeminiVideoOperation>
>) {
  const generatedVideo =
    operation.response?.generatedVideos?.[0]?.video ??
    operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video ??
    null;

  if (!generatedVideo?.uri) {
    return null;
  }

  return {
    uri: generatedVideo.uri,
    mimeType: generatedVideo.mimeType ?? "video/mp4",
  };
}

export async function downloadGeminiVideoFile(fileUri: string) {
  const apiKey = getRequiredGeminiApiKey();
  const response = await fetch(fileUri, {
    headers: {
      "x-goog-api-key": apiKey,
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Gemini video download failed: ${await response.text()}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
