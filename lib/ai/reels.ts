import { setTimeout as delay } from "node:timers/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMediaStorage, getUploadStorageBucket } from "@/lib/storage/media";

export const REELS_PROVIDER = "postalk-reels";
export type ReelsConcept = "simple" | "christmas";
export const REELS_SHOT_PLAN = [
  "video_storefront_sign",
  "video_signature_menu",
  "video_signature_interaction",
  "video_storefront_entry",
] as const;

export function isReelsEnabled() {
  return Boolean(process.env.REELS_API_URL?.trim());
}

type SourceVideo = { shotKey: string; storageBucket: string; filePath: string };
export type ReelsInput = {
  concept: ReelsConcept;
  store: { name: string; description: string };
  menuName: string;
  subtitles: [string, string, string, string];
  caption: string;
  hashtags: string[];
};

export function buildReelsInput(params: {
  storeName: string; storeDescription: string; menuName: string; menuDescription?: string;
  concept?: ReelsConcept;
  script: { hookText: string; caption: string; hashtags: string[]; workingCaptions: string[] };
}): ReelsInput {
  const caption = (value: string, max: number) => Array.from(value.replace(/\s+/g, " ").trim()).slice(0, max).join("");
  return {
    concept: params.concept ?? "simple",
    store: { name: params.storeName, description: params.storeDescription },
    menuName: params.menuName,
    subtitles: [
      caption(params.script.hookText || params.storeName, 14),
      caption(params.menuName, 12),
      caption(params.menuDescription || params.script.workingCaptions[3] || params.menuName, 16),
      caption(params.script.workingCaptions.at(-1) || "오늘 들러 보세요", 16),
    ],
    caption: params.script.caption,
    hashtags: params.script.hashtags,
  };
}

type RenderResponse = {
  render_id?: string;
  status?: "queued" | "rendering" | "done" | "failed";
  detail?: { code?: string; render_id?: string };
  error?: { code?: string };
  result?: { video_key?: string; thumbnail_key?: string; video_bytes?: number; thumbnail_bytes?: number; duration_sec?: number };
};

export async function renderReelInStorage(params: {
  client: SupabaseClient;
  jobId: string;
  filePath: string;
  sources: SourceVideo[];
  input: ReelsInput;
}) {
  const apiUrl = process.env.REELS_API_URL?.trim();
  const key = process.env.REELS_INTERNAL_API_KEY?.trim();
  if (!apiUrl || !key) throw new Error("Reels service URL or credentials are missing");
  const base = new URL(apiUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
    throw new Error("Invalid reels service URL");
  }

  const selected = REELS_SHOT_PLAN.map(shot => params.sources.find(source => source.shotKey === shot));
  const media = await Promise.all(selected.map(async (source, scene_index) => {
    if (!source) throw new Error("A required reel clip is missing");
    const { data, error } = await getMediaStorage(params.client).from(source.storageBucket)
      .createSignedUrl(source.filePath, 15 * 60);
    if (error || !data?.signedUrl) throw new Error("Unable to sign a source clip");
    return {
      scene_index,
      menu_index: scene_index === 1 || scene_index === 2 ? 0 : null,
      key: source.filePath,
      storage: "supabase",
      download_url: data.signedUrl,
    };
  }));

  const thumbnailPath = params.filePath.replace(/\.mp4$/, ".jpg");
  const bucket = getMediaStorage(params.client).from(getUploadStorageBucket());
  const signUpload = async (path: string) => {
    const { data, error } = await bucket.createSignedUploadUrl(path, { upsert: true });
    if (error || !data?.signedUrl) throw new Error("Unable to sign a reel output");
    return data.signedUrl;
  };
  const [video_url, thumbnail_url] = await Promise.all([signUpload(params.filePath), signUpload(thumbnailPath)]);
  const body = JSON.stringify({
    user_id: 1,
    ad_id: params.jobId,
    concept: params.input.concept,
    store: params.input.store,
    menus: [{ menu_index: 0, name: params.input.menuName }],
    media,
    scenes: params.input.subtitles.map((text, scene_index) => ({ scene_index, text })),
    caption: params.input.caption,
    hashtags: params.input.hashtags,
    uploads: { video_url, thumbnail_url },
  });

  const signal = AbortSignal.timeout(200_000);
  const request = async (path: string, body?: string) => {
    const response = await fetch(new URL(path, base), {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "x-reels-api-key": key },
      body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      redirect: "error",
      cache: "no-store",
    });
    const data: RenderResponse = await response.json();
    return { response, data };
  };
  const submit = async () => {
    const { response, data } = await request("/reels/renders", body);
    const id = response.ok ? data.render_id
      : response.status === 409 && data.detail?.code === "ALREADY_RENDERING" ? data.detail.render_id : null;
    if (!id || !/^rr_[0-9a-f]+$/.test(id)) throw new Error(`Reels service rejected the render (HTTP ${response.status})`);
    return id;
  };

  let renderId = await submit();
  let resumed = false;
  while (!signal.aborted) {
    const { response, data } = await request(`/reels/renders/${renderId}`);
    if (response.status === 404 && !resumed) {
      resumed = true;
      renderId = await submit();
      continue;
    }
    if (!response.ok) throw new Error(`Unable to check reel status (HTTP ${response.status})`);
    if (data.status === "failed") throw new Error(`Reels rendering failed (${data.error?.code ?? "RENDER_FAILED"})`);
    if (data.status === "done") {
      const result = data.result;
      if (!result || result.video_key !== params.filePath || result.thumbnail_key !== thumbnailPath ||
          !validBytes(result.video_bytes) || !validBytes(result.thumbnail_bytes) ||
          typeof result.duration_sec !== "number" || !Number.isFinite(result.duration_sec) || result.duration_sec <= 0) {
        throw new Error("Reels service returned invalid output metadata");
      }
      return { renderId, thumbnailPath, videoBytes: result.video_bytes, thumbnailBytes: result.thumbnail_bytes, durationSeconds: result.duration_sec };
    }
    if (data.status !== "queued" && data.status !== "rendering") throw new Error("Reels service returned an unknown status");
    await delay(2000, undefined, { signal });
  }
  throw new Error("Reels service timed out");
}

function validBytes(bytes: unknown): bytes is number {
  return typeof bytes === "number" && Number.isInteger(bytes) && bytes > 0 && bytes <= 50 * 1024 * 1024;
}
