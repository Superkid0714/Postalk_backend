import { getQuoteVideoEnv } from "@/lib/env";
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

  if (!env.bgmUrl) {
    throw new Error("QUOTE_VIDEO_BGM_URL is not configured");
  }

  return env;
}

export async function renderQuoteVideo(params: QuoteVideoRenderRequest) {
  const env = getRequiredQuoteVideoEnv() as {
    apiUrl: string;
    apiKey: string | null;
    bgmUrl: string;
    timeoutSeconds: number;
  };
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
      bgm_url: env.bgmUrl,
      timeout_seconds: env.timeoutSeconds,
    }),
    timeoutMs: Math.max(30_000, env.timeoutSeconds * 1000 + 15_000),
  });

  if (!response.ok) {
    throw new Error(`Quote video render failed: ${await response.text()}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
