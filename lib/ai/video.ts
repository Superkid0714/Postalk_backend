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

export function buildVideoPrompt(
  submission: SubmissionForVideoPrompt,
  stylePreset: VideoStylePreset,
) {
  const styleDirection =
    stylePreset === "premium"
      ? "Cinematic, polished, premium food commercial look with crisp lighting."
      : stylePreset === "food_closeup"
        ? "Tight closeups of the food, appetizing texture, steam, glossy highlights, short-form ad energy."
        : "Warm Korean traditional-market storytelling tone, lively yet clean, neighborhood charm.";

  return [
    "Create a vertical 9:16 Korean short-form food advertisement video.",
    "Duration: exactly 8 seconds.",
    "Use the provided food image as strong visual guidance.",
    "The result must feel like a mobile ad for a real Korean market merchant.",
    `Market: ${submission.marketName}`,
    `Store: ${submission.storeName}`,
    `Store type: ${submission.storeType}`,
    `Featured menu: ${submission.targetMenuName}`,
    submission.priceText ? `Price text: ${submission.priceText}` : null,
    `Appeal point: ${submission.appealPoint}`,
    submission.extraMessage
      ? `Extra merchant note: ${submission.extraMessage}`
      : null,
    "Show the food clearly and attractively.",
    "Add subtle Korean ad-style on-screen text naturally integrated into the scene.",
    "Keep the video visually coherent and suitable for an 8-second promotional reel.",
    "Avoid logos, app UI, fake QR codes, watermarks, subtitles unrelated to the ad, or unreadable clutter.",
    `Visual direction: ${styleDirection}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildVideoScript(
  submission: SubmissionForVideoPrompt,
  stylePreset: VideoStylePreset,
): VideoGenerationScript {
  const hookText =
    stylePreset === "premium"
      ? `${submission.targetMenuName}, 오늘 더 특별하게`
      : `${submission.storeName} 인기 메뉴`;

  return {
    hookText,
    scenes: [
      {
        order: 1,
        text: `${submission.storeName} 대표 메뉴`,
        focus: "store_intro",
      },
      {
        order: 2,
        text: submission.appealPoint,
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
    caption: `${submission.targetMenuName} 어떠세요? ${submission.appealPoint}`,
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

  const instance: Record<string, unknown> = {
    prompt: params.prompt,
  };

  if (params.image) {
    instance.image = {
      inlineData: {
        mimeType: params.image.mimeType,
        data: params.image.bytesBase64,
      },
    };
  }

  const response = await fetch(
    `${GEMINI_BASE_URL}/models/${model}:predictLongRunning`,
    {
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
          durationSeconds: String(params.durationSeconds),
          numberOfVideos: 1,
        },
      }),
    },
  );

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
