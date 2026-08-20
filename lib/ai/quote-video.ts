import { access } from "node:fs/promises";
import path from "node:path";

import { getPublicAppUrl, getQuoteVideoEnv } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http";

export type QuoteVideoRenderRequest = {
  videoUrls: string[];
  captionMarkdown: string;
};

function getRequiredQuoteVideoEnv() {
  const env = getQuoteVideoEnv();

  if (!env.apiUrl) {
    throw new Error("QUOTE_VIDEO_API_URL is not configured");
  }

  return env;
}

async function resolveQuoteVideoBgmUrl(explicitBgmUrl: string | null) {
  if (explicitBgmUrl) {
    return explicitBgmUrl;
  }

  const publicAppUrl = getPublicAppUrl();

  if (!publicAppUrl) {
    throw new Error(
      "QUOTE_VIDEO_BGM_URL is not configured and PUBLIC_APP_URL/VERCEL_URL is unavailable",
    );
  }

  const fallbackBgmPath = path.join(
    process.cwd(),
    "public",
    "bgm",
    "default.mp3",
  );

  try {
    await access(fallbackBgmPath);
  } catch {
    throw new Error(
      "QUOTE_VIDEO_BGM_URL is not configured and public/bgm/default.mp3 is missing",
    );
  }

  return new URL("/bgm/default.mp3", publicAppUrl).toString();
}

export async function renderQuoteVideo(params: QuoteVideoRenderRequest) {
  const env = getRequiredQuoteVideoEnv() as {
    apiUrl: string;
    apiKey: string | null;
    bgmUrl: string | null;
    timeoutSeconds: number;
  };
  const bgmUrl = await resolveQuoteVideoBgmUrl(env.bgmUrl);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (env.apiKey) {
    headers["x-api-key"] = env.apiKey;
  }

  const response = await fetchWithTimeout(new URL("/generate", env.apiUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({
      video_urls: params.videoUrls,
      caption_markdown: params.captionMarkdown,
      bgm_url: bgmUrl,
      timeout_seconds: env.timeoutSeconds,
    }),
    timeoutMs: Math.max(30_000, env.timeoutSeconds * 1000 + 15_000),
  });

  if (!response.ok) {
    throw new Error(`Quote video render failed: ${await response.text()}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
