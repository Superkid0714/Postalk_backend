import { getGeminiApiKey, getGeminiVideoModel } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http";

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
  workingCaptions: string[];
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

function normalizeSentencePart(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function buildWorkingCaptionSentences(
  submission: SubmissionForVideoPrompt,
  foodProfile: VideoFoodProfile,
) {
  const storeName = normalizeSentencePart(submission.storeName) || "이 가게";
  const marketName = normalizeSentencePart(submission.marketName) || "전통시장";
  const targetMenuName =
    normalizeSentencePart(submission.targetMenuName) || "대표 메뉴";
  const appealPoint =
    normalizeSentencePart(submission.appealPoint) || "한 번 더 생각나는 맛";
  const extraMessage = normalizeSentencePart(submission.extraMessage);
  const targetCustomer = normalizeSentencePart(submission.targetCustomer);
  const peakSalesTime = normalizeSentencePart(submission.peakSalesTime);
  const popularMenuNotes = normalizeSentencePart(submission.popularMenuNotes);

  const specialtyLine = extraMessage
    ? `${storeName}의 특별함은 ${extraMessage}에 있습니다.`
    : `${marketName} 안에서 ${storeName}만의 분위기가 살아 있습니다.`;
  const customerLine = targetCustomer
    ? `${targetCustomer}에게 특히 잘 어울리는 메뉴로 사랑받고 있습니다.`
    : `${targetMenuName}을 고르는 순간부터 기대감이 살아납니다.`;
  const timingLine = peakSalesTime
    ? `${peakSalesTime}에 가장 먼저 떠오르는 메뉴로 손님을 부릅니다.`
    : `${targetMenuName} 한 상이 완성되기까지의 흐름이 자연스럽게 이어집니다.`;
  const sideMenuLine = popularMenuNotes
    ? `${popularMenuNotes}처럼 곁들이기 좋은 메뉴도 함께 즐길 수 있습니다.`
    : `함께 곁들이는 메뉴까지 더해져 식탁의 만족감이 커집니다.`;

  return [
    `${marketName}의 ${storeName}가 먼저 눈길을 끕니다.`,
    specialtyLine,
    `메뉴판에서 ${targetMenuName}의 매력을 바로 확인할 수 있습니다.`,
    `${targetMenuName}의 첫 인상은 ${appealPoint}입니다.`,
    customerLine,
    `${targetMenuName}은 ${foodProfile.detailFocus}이 살아 있도록 완성됩니다.`,
    timingLine,
    sideMenuLine,
  ].map((line) => line.replace(/\s+/g, " ").trim());
}

function splitWorkingCaptionLine(line: string) {
  const normalized = line.trim().replace(/\s+/g, " ");

  if (normalized.length <= 8) {
    return [normalized, normalized];
  }

  const midpoint = Math.floor(normalized.length / 2);
  const leftSpace = normalized.lastIndexOf(" ", midpoint);
  const rightSpace = normalized.indexOf(" ", midpoint);

  const splitIndexCandidates = [leftSpace, rightSpace].filter(
    (value) => value >= 0,
  );
  const splitIndex =
    splitIndexCandidates.length > 0
      ? splitIndexCandidates.sort(
          (left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint),
        )[0]
      : midpoint;

  const first = normalized.slice(0, splitIndex).trim();
  const second = normalized.slice(splitIndex).trim();

  return [first || normalized, second || normalized];
}

export function buildWorkingCaptionMarkdown(script: VideoGenerationScript) {
  const subtitleLines = script.workingCaptions.flatMap((sentence) =>
    splitWorkingCaptionLine(sentence),
  );

  return script.workingCaptions
    .map((_, cutIndex) => {
      const startSecond = cutIndex * 2;
      const firstLine = subtitleLines[cutIndex * 2] ?? "";
      const secondLine = subtitleLines[cutIndex * 2 + 1] ?? "";
      const firstSubtitleIndex = cutIndex * 2 + 1;
      const secondSubtitleIndex = cutIndex * 2 + 2;

      const formatSecond = (value: number) => String(value).padStart(2, "0");

      return [
        `## [비디오 컷 ${cutIndex + 1}] (00:${formatSecond(startSecond)} ~ 00:${formatSecond(startSecond + 2)})`,
        `* **[00:${formatSecond(startSecond)} ~ 00:${formatSecond(startSecond + 1)}] 자막 ${firstSubtitleIndex}:** ${firstLine}`,
        `* **[00:${formatSecond(startSecond + 1)} ~ 00:${formatSecond(startSecond + 2)}] 자막 ${secondSubtitleIndex}:** ${secondLine}`,
      ].join("\n");
    })
    .join("\n\n");
}

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
  const workingCaptions = buildWorkingCaptionSentences(submission, foodProfile);
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
    workingCaptions,
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

    return fetchWithTimeout(`${GEMINI_BASE_URL}/models/${model}:predictLongRunning`, {
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
      timeoutMs: 60_000,
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
  const response = await fetchWithTimeout(`${GEMINI_BASE_URL}/${operationName}`, {
    headers: {
      "x-goog-api-key": apiKey,
    },
    timeoutMs: 30_000,
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
  const response = await fetchWithTimeout(fileUri, {
    headers: {
      "x-goog-api-key": apiKey,
    },
    redirect: "follow",
    timeoutMs: 120_000,
  });

  if (!response.ok) {
    throw new Error(`Gemini video download failed: ${await response.text()}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
