import { getGeminiApiKey, getGeminiVideoModel, getOpenAiApiKey } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_VIDEO_MODEL = "veo-3.1-generate-preview";
const VIDEO_CAPTION_REVIEW_MODEL = "gpt-4.1-mini";

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

type OpenAiResponsesResponse = {
  output_text?: string;
};

export type SubmissionForVideoPrompt = {
  storeName: string;
  marketName: string;
  ownerName?: string | null;
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
  detailFocusKorean: string;
  endingShot: string;
  colorMood: string;
};

function normalizeSentencePart(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function hasLatinCharacters(value: string) {
  return /[A-Za-z]/.test(value);
}

function compactComparableText(value: string | null | undefined) {
  return normalizeSentencePart(value).replace(/\s+/g, "");
}

function includesOwnerName(value: string, ownerName: string | null | undefined) {
  const comparableOwnerName = compactComparableText(ownerName);

  if (comparableOwnerName.length < 2) {
    return false;
  }

  return compactComparableText(value).includes(comparableOwnerName);
}

function sanitizeVideoCaptionPart(
  value: string | null | undefined,
  fallback: string,
  ownerName: string | null | undefined,
) {
  const normalized = normalizeSentencePart(value);

  if (
    !normalized ||
    hasLatinCharacters(normalized) ||
    includesOwnerName(normalized, ownerName)
  ) {
    return fallback;
  }

  return normalized;
}

function sanitizeOptionalVideoCaptionPart(
  value: string | null | undefined,
  ownerName: string | null | undefined,
) {
  const normalized = normalizeSentencePart(value);

  if (
    !normalized ||
    hasLatinCharacters(normalized) ||
    includesOwnerName(normalized, ownerName)
  ) {
    return null;
  }

  return normalized;
}

function buildSafeVideoCaptionContext(submission: SubmissionForVideoPrompt) {
  const ownerName = normalizeSentencePart(submission.ownerName);

  return {
    storeName: sanitizeVideoCaptionPart(submission.storeName, "이 가게", ownerName),
    marketName: sanitizeVideoCaptionPart(
      submission.marketName,
      "전통시장",
      ownerName,
    ),
    targetMenuName: sanitizeVideoCaptionPart(
      submission.targetMenuName,
      "대표 메뉴",
      ownerName,
    ),
    appealPoint: sanitizeVideoCaptionPart(
      submission.appealPoint,
      "한 번 더 생각나는 맛",
      ownerName,
    ),
    extraMessage: sanitizeOptionalVideoCaptionPart(
      submission.extraMessage,
      ownerName,
    ),
    targetCustomer: sanitizeOptionalVideoCaptionPart(
      submission.targetCustomer,
      ownerName,
    ),
    peakSalesTime: sanitizeOptionalVideoCaptionPart(
      submission.peakSalesTime,
      ownerName,
    ),
    popularMenuNotes: sanitizeOptionalVideoCaptionPart(
      submission.popularMenuNotes,
      ownerName,
    ),
    ownerName,
  };
}

function stripCodeFence(value: string) {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function sanitizeWorkingCaptionLine(value: string) {
  return value
    .replace(/[*#`_[\]{}<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCompactCaptionText(text: string) {
  const normalized = text.trim();

  if (normalized.length <= 2) {
    return [normalized, normalized];
  }

  const midpoint = Math.floor(normalized.length / 2);
  const first = normalized.slice(0, midpoint).trim();
  const second = normalized.slice(midpoint).trim();

  return [first || normalized, second || normalized];
}

function pickBalancedSplitIndex(text: string) {
  const midpoint = Math.floor(text.length / 2);
  const candidateIndexes = Array.from(
    text.matchAll(/[,:;.!?~·]| /g),
    (match) => match.index ?? -1,
  ).filter((index) => index > 2 && index < text.length - 2);

  if (candidateIndexes.length === 0) {
    return -1;
  }

  return candidateIndexes.sort(
    (left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint),
  )[0]!;
}

function buildWorkingCaptionSentences(
  submission: SubmissionForVideoPrompt,
  foodProfile: VideoFoodProfile,
) {
  const safeContext = buildSafeVideoCaptionContext(submission);
  const storeName = safeContext.storeName;
  const marketName = safeContext.marketName;
  const targetMenuName = safeContext.targetMenuName;
  const appealPoint = safeContext.appealPoint;
  const extraMessage = safeContext.extraMessage ?? "";
  const targetCustomer = safeContext.targetCustomer ?? "";
  const peakSalesTime = safeContext.peakSalesTime ?? "";
  const popularMenuNotes = safeContext.popularMenuNotes ?? "";

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
    `${targetMenuName}은 ${foodProfile.detailFocusKorean} 살아 있도록 완성됩니다.`,
    timingLine,
    sideMenuLine,
  ].map((line) => line.replace(/\s+/g, " ").trim());
}

function buildAiWorkingCaptionPrompt(params: {
  submission: SubmissionForVideoPrompt;
  stylePreset: VideoStylePreset;
  foodProfile: VideoFoodProfile;
  fallbackCaptions: string[];
}) {
  const { submission, stylePreset, foodProfile, fallbackCaptions } = params;

  return [
    "You rewrite Korean working captions for a real food advertisement video.",
    "These are internal production subtitles for the video timeline, not the public Instagram caption.",
    "Return strict JSON only in this shape: {\"workingCaptions\":[\"...\", \"...\", ...]}",
    "Rules:",
    "- Write exactly 8 Korean working captions.",
    "- Each caption should feel natural when shown alone for about 1 to 2 seconds.",
    "- Keep each caption short, readable, promotional, and conversational.",
    "- No hashtags, no emojis, no markdown, no bullet points, no numbering.",
    "- Do not use any English letters or English words in the caption lines.",
    "- Do not mention any owner name or owner identity.",
    "- Do not mention that this is an ad, prompt, template, or caption.",
    "- Avoid robotic repetition and avoid report-style phrasing.",
    "- Ground the wording in the actual store, menu, taste, atmosphere, and customer appeal.",
    "- Keep each caption ideally under 24 Korean characters if possible.",
    "- The 8 lines should flow like a coherent short video: hook, atmosphere, menu appeal, taste detail, audience fit, timing/value, and closing attraction.",
    `Visual style preset: ${stylePreset}`,
    `Food category: ${foodProfile.category}`,
    `Store name: ${submission.storeName}`,
    `Market name: ${submission.marketName}`,
    `Store type: ${submission.storeType}`,
    `Featured menu: ${submission.targetMenuName}`,
    submission.priceText ? `Price info: ${submission.priceText}` : "Price info: 없음",
    `Appeal point: ${submission.appealPoint}`,
    submission.extraMessage
      ? `Merchant note: ${submission.extraMessage}`
      : "Merchant note: 없음",
    submission.targetCustomer
      ? `Target customer: ${submission.targetCustomer}`
      : "Target customer: 없음",
    submission.peakSalesTime
      ? `Best timing: ${submission.peakSalesTime}`
      : "Best timing: 없음",
    submission.popularMenuNotes
      ? `Popular menu notes: ${submission.popularMenuNotes}`
      : "Popular menu notes: 없음",
    `Food detail focus: ${foodProfile.detailFocus}`,
    "Use these fallback lines only as a reference for facts and order, but rewrite them more naturally:",
    JSON.stringify(fallbackCaptions, null, 2),
  ]
    .filter(Boolean)
    .join("\n");
}

export function normalizeAiWorkingCaptions(
  candidate: unknown,
  fallbackCaptions: string[],
  options?: {
    ownerName?: string | null;
  },
) {
  const rawCaptions = Array.isArray(candidate)
    ? candidate
    : candidate &&
        typeof candidate === "object" &&
        !Array.isArray(candidate) &&
        Array.isArray((candidate as { workingCaptions?: unknown }).workingCaptions)
      ? (candidate as { workingCaptions: unknown[] }).workingCaptions
      : null;

  if (!rawCaptions || rawCaptions.length !== fallbackCaptions.length) {
    return fallbackCaptions;
  }

  const normalized = rawCaptions.map((item) => {
    if (typeof item !== "string") {
      return "";
    }

    return sanitizeWorkingCaptionLine(item);
  });

  if (
    normalized.some(
      (item) =>
        item.length < 4 ||
        item.length > 32 ||
        hasLatinCharacters(item) ||
        includesOwnerName(item, options?.ownerName),
    )
  ) {
    return fallbackCaptions;
  }

  const uniqueCount = new Set(
    normalized.map((item) => item.replace(/\s+/g, "")),
  ).size;

  if (uniqueCount < 6) {
    return fallbackCaptions;
  }

  return normalized;
}

function splitWorkingCaptionLine(line: string) {
  const normalized = line.trim().replace(/\s+/g, " ");

  if (normalized.length <= 8) {
    return splitCompactCaptionText(normalized);
  }

  const splitIndex = pickBalancedSplitIndex(normalized);

  if (splitIndex < 0) {
    return splitCompactCaptionText(normalized);
  }

  const first = normalized.slice(0, splitIndex).trim();
  const second = normalized.slice(splitIndex + 1).trim();

  if (!first || !second) {
    return splitCompactCaptionText(normalized);
  }

  return [first, second];
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
      detailFocusKorean: "신선한 결과 촉촉한 식감이",
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
      detailFocusKorean: "국물의 깊이와 따뜻한 온기가",
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
      detailFocusKorean: "바삭한 결와 속의 촉촉함이",
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
      detailFocusKorean: "불향과 진한 육즙이",
      endingShot: "luxurious hero frame with premium food-commercial finish",
      colorMood: "bronze, deep brown, and warm smoky highlights",
    };
  }

  return {
    category: "general_food",
    openingShot: "strong appetizing hero reveal of the featured dish",
    motionStyle: "smooth premium short-form ad camera movement",
    detailFocus: "texture, freshness, serving size, and believable appeal",
    detailFocusKorean: "먹음직스러운 결와 온기가",
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
  const safeContext = buildSafeVideoCaptionContext(submission);
  const foodProfile = inferVideoFoodProfile(
    submission.storeType,
    submission.targetMenuName,
  );
  const workingCaptions = buildWorkingCaptionSentences(submission, foodProfile);
  const hookText =
    stylePreset === "premium"
      ? `${safeContext.targetMenuName}, 오늘 더 특별하게`
      : `${safeContext.storeName} 인기 메뉴`;

  return {
    hookText,
    scenes: [
      {
        order: 1,
        text:
          stylePreset === "market_story"
            ? `${safeContext.storeName} 추천 메뉴`
            : `${safeContext.storeName} 대표 메뉴`,
        focus: "store_intro",
      },
      {
        order: 2,
        text:
          safeContext.appealPoint.length > 24
            ? `${safeContext.targetMenuName}의 진한 매력`
            : safeContext.appealPoint,
        focus: "food_highlight",
      },
      {
        order: 3,
        text: submission.priceText
          ? `${safeContext.targetMenuName} ${submission.priceText}`
          : safeContext.targetMenuName,
        focus: "price_cta",
      },
    ],
    workingCaptions,
    caption: `${safeContext.targetMenuName} 어떠세요? ${safeContext.appealPoint} ${foodProfile.detailFocus}`,
    hashtags: [
      `#${submission.marketName.replace(/\s+/g, "")}`,
      `#${submission.storeName.replace(/\s+/g, "")}`,
      `#${submission.targetMenuName.replace(/\s+/g, "")}`,
    ],
  };
}

export async function buildVideoScriptWithAi(
  submission: SubmissionForVideoPrompt,
  stylePreset: VideoStylePreset,
) {
  const fallbackScript = buildVideoScript(submission, stylePreset);
  const apiKey = getOpenAiApiKey();

  if (!apiKey) {
    return fallbackScript;
  }

  const foodProfile = inferVideoFoodProfile(
    submission.storeType,
    submission.targetMenuName,
  );

  try {
    const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VIDEO_CAPTION_REVIEW_MODEL,
        input: buildAiWorkingCaptionPrompt({
          submission,
          stylePreset,
          foodProfile,
          fallbackCaptions: fallbackScript.workingCaptions,
        }),
      }),
      timeoutMs: 30_000,
    });

    if (!response.ok) {
      return fallbackScript;
    }

    const json = (await response.json()) as OpenAiResponsesResponse;
    const outputText =
      typeof json.output_text === "string" ? stripCodeFence(json.output_text) : "";

    if (!outputText) {
      return fallbackScript;
    }

    const workingCaptions = normalizeAiWorkingCaptions(
      JSON.parse(outputText),
      fallbackScript.workingCaptions,
      {
        ownerName: submission.ownerName,
      },
    );

    return {
      ...fallbackScript,
      workingCaptions,
    };
  } catch {
    return fallbackScript;
  }
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
