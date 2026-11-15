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
  menuDescription?: string;
};

export function buildReelsInput(params: {
  storeName: string; storeDescription: string; menuName: string; menuDescription?: string;
  concept?: ReelsConcept;
  script: { hookText: string; caption: string; hashtags: string[]; workingCaptions: string[] };
}): ReelsInput {
  return {
    concept: params.concept ?? "simple",
    store: { name: params.storeName, description: params.storeDescription },
    menuName: params.menuName,
    menuDescription: params.menuDescription,
  };
}

type RenderResponse = {
  render_id?: string;
  status?: "queued" | "rendering" | "done" | "failed";
  detail?: { code?: string; render_id?: string };
  error?: { code?: string };
  result?: { video_key?: string; thumbnail_key?: string; video_bytes?: number; thumbnail_bytes?: number; duration_sec?: number };
};

type ScriptResponse = {
  script_id?: string;
  status?: "pending" | "done" | "failed";
  is_fallback?: boolean;
  scenes?: Array<{ scene_index?: number; text?: string }>;
  caption?: string;
  hashtags?: string[];
  error?: { code?: string };
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
    const data: RenderResponse | ScriptResponse = await response.json();
    return { response, data };
  };
  const scriptRequest = JSON.stringify({
    user_id: 1,
    concept: params.input.concept,
    store: params.input.store,
    menus: [{ menu_index: 0, name: params.input.menuName, description: params.input.menuDescription ?? "" }],
  });
  const acceptedScript = await request("/reels/scripts", scriptRequest);
  const scriptId = acceptedScript.response.ok && typeof (acceptedScript.data as ScriptResponse).script_id === "string"
    ? (acceptedScript.data as ScriptResponse).script_id
    : null;
  if (!scriptId || !/^rs_[0-9a-f]+$/.test(scriptId)) {
    throw new Error(`Reels service rejected script generation (HTTP ${acceptedScript.response.status})`);
  }

  let script: ScriptResponse | null = null;
  while (!signal.aborted) {
    const { response, data } = await request(`/reels/scripts/${scriptId}`);
    const candidate = data as ScriptResponse;
    if (!response.ok) throw new Error(`Unable to check reel script status (HTTP ${response.status})`);
    if (candidate.status === "failed") throw new Error(`Reels script generation failed (${candidate.error?.code ?? "SCRIPT_GENERATION_FAILED"})`);
    if (candidate.status === "done") {
      script = candidate;
      break;
    }
    await delay(500, undefined, { signal });
  }
  if (!script || !Array.isArray(script.scenes) || script.scenes.length !== 4 ||
      typeof script.caption !== "string" || !script.caption.trim() ||
      !Array.isArray(script.hashtags) || script.hashtags.length === 0) {
    throw new Error("Reels service returned an incomplete script");
  }
  const scenes = script.scenes.map((scene, scene_index) => {
    if (scene.scene_index !== scene_index || typeof scene.text !== "string" || !scene.text.trim()) {
      throw new Error("Reels service returned invalid scene captions");
    }
    return { scene_index, text: scene.text };
  });
  const body = JSON.stringify({
    user_id: 1,
    ad_id: params.jobId,
    concept: params.input.concept,
    store: params.input.store,
    menus: [{ menu_index: 0, name: params.input.menuName, description: params.input.menuDescription ?? "" }],
    media,
    scenes,
    caption: script.caption,
    hashtags: script.hashtags,
    uploads: { video_url, thumbnail_url },
  });
  const submit = async () => {
    const { response, data } = await request("/reels/renders", body);
    const render = data as RenderResponse;
    const id = response.ok ? render.render_id
      : response.status === 409 && render.detail?.code === "ALREADY_RENDERING" ? render.detail.render_id : null;
    if (!id || !/^rr_[0-9a-f]+$/.test(id)) throw new Error(`Reels service rejected the render (HTTP ${response.status})`);
    return id;
  };

  let renderId = await submit();
  let resumed = false;
  while (!signal.aborted) {
    const { response, data } = await request(`/reels/renders/${renderId}`);
    const render = data as RenderResponse;
    if (response.status === 404 && !resumed) {
      resumed = true;
      renderId = await submit();
      continue;
    }
    if (!response.ok) throw new Error(`Unable to check reel status (HTTP ${response.status})`);
    if (render.status === "failed") throw new Error(`Reels rendering failed (${render.error?.code ?? "RENDER_FAILED"})`);
    if (render.status === "done") {
      const result = render.result;
      if (!result || result.video_key !== params.filePath || result.thumbnail_key !== thumbnailPath ||
          !validBytes(result.video_bytes) || !validBytes(result.thumbnail_bytes) ||
          typeof result.duration_sec !== "number" || !Number.isFinite(result.duration_sec) || result.duration_sec <= 0) {
        throw new Error("Reels service returned invalid output metadata");
      }
      return {
        renderId, thumbnailPath, videoBytes: result.video_bytes, thumbnailBytes: result.thumbnail_bytes,
        durationSeconds: result.duration_sec, caption: script.caption, hashtags: script.hashtags,
        scriptFallback: script.is_fallback === true,
      };
    }
    if (render.status !== "queued" && render.status !== "rendering") throw new Error("Reels service returned an unknown status");
    await delay(2000, undefined, { signal });
  }
  throw new Error("Reels service timed out");
}

function validBytes(bytes: unknown): bytes is number {
  return typeof bytes === "number" && Number.isInteger(bytes) && bytes > 0 && bytes <= 50 * 1024 * 1024;
}
