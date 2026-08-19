import { getInstagramEnv } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type InstagramMediaType = "photo" | "video";

type InstagramPublishStatus = "processing" | "published" | "failed";

export type InstagramPublishMetadata = {
  mediaType?: InstagramMediaType | null;
  status?: InstagramPublishStatus | null;
  containerId?: string | null;
  publishedMediaId?: string | null;
  caption?: string | null;
  assetId?: string | null;
  assetPath?: string | null;
  containerStatusCode?: string | null;
  requestedAt?: string | null;
  publishedAt?: string | null;
  lastCheckedAt?: string | null;
  lastError?: string | null;
};

type InstagramSubmissionRow = {
  id: string;
  status: "pending_review" | "approved" | "rejected";
  caption: string | null;
  hashtags: string[] | null;
  target_menu_name: string;
  appeal_point: string;
  extra_message: string | null;
  ai_metadata: Record<string, unknown> | null;
  generation_jobs:
    | Array<{
        id: string;
        status: string;
        model_name: string;
        result_asset_id: string | null;
        created_at: string;
      }>
    | null;
  submission_assets:
    | Array<{
        id: string;
        asset_type: string;
        storage_bucket: string;
        file_path: string;
        file_name: string | null;
        mime_type: string | null;
        created_at: string;
      }>
    | null;
};

type InstagramPublishResult = {
  ok: boolean;
  submissionId: string;
  mediaType: InstagramMediaType;
  status: InstagramPublishStatus;
  containerId: string | null;
  publishedMediaId: string | null;
  caption: string | null;
  lastError: string | null;
};

type InstagramContainerStatus = {
  id?: string;
  status_code?: string;
  status?: string;
};

type WaitForInstagramPublishCompletionOptions = {
  maxAttempts?: number;
  delayMs?: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getInstagramPublishMetadata(
  aiMetadata: Record<string, unknown> | null | undefined,
): InstagramPublishMetadata {
  if (!isObject(aiMetadata)) {
    return {};
  }

  const instagramPublish = aiMetadata.instagramPublish;

  if (!isObject(instagramPublish)) {
    return {};
  }

  return instagramPublish as InstagramPublishMetadata;
}

export function mergeInstagramPublishMetadata(
  aiMetadata: Record<string, unknown> | null | undefined,
  updates: Partial<InstagramPublishMetadata>,
) {
  const base = isObject(aiMetadata) ? aiMetadata : {};
  const current = getInstagramPublishMetadata(aiMetadata);

  return {
    ...base,
    instagramPublish: {
      ...current,
      ...updates,
    },
  };
}

function getPhotoPublishRequestStatus(aiMetadata: Record<string, unknown> | null) {
  if (!isObject(aiMetadata) || !isObject(aiMetadata.adWorkflow)) {
    return null;
  }

  const status = aiMetadata.adWorkflow.publishRequestStatus;
  return typeof status === "string" ? status : null;
}

function getVideoPublishRequestStatus(aiMetadata: Record<string, unknown> | null) {
  if (!isObject(aiMetadata) || !isObject(aiMetadata.videoWorkflow)) {
    return null;
  }

  const status = aiMetadata.videoWorkflow.status;
  return typeof status === "string" ? status : null;
}

function getVideoScriptCaption(aiMetadata: Record<string, unknown> | null) {
  if (
    !isObject(aiMetadata) ||
    !isObject(aiMetadata.videoWorkflow) ||
    !isObject(aiMetadata.videoWorkflow.script)
  ) {
    return null;
  }

  const caption = aiMetadata.videoWorkflow.script.caption;
  return typeof caption === "string" ? caption : null;
}

function buildInstagramCaption(submission: InstagramSubmissionRow) {
  const baseCaption =
    submission.caption?.trim() ||
    getVideoScriptCaption(submission.ai_metadata)?.trim() ||
    [submission.target_menu_name, submission.appeal_point, submission.extra_message]
      .filter((value) => typeof value === "string" && value.trim())
      .join(" ");

  const hashtags = (submission.hashtags ?? [])
    .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    .join(" ");

  return [baseCaption, hashtags].filter(Boolean).join("\n\n") || null;
}

function getInstagramConfig() {
  const env = getInstagramEnv();

  if (!env.accessToken || !env.igUserId) {
    return null;
  }

  return env;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readGraphError(response: Response) {
  const text = await response.text();

  try {
    const json = JSON.parse(text) as {
      error?: { message?: string; code?: number; error_subcode?: number };
    };
    const message = json.error?.message ?? text;
    return message;
  } catch {
    return text;
  }
}

async function postGraphForm<T>(
  path: string,
  payload: Record<string, string>,
): Promise<T> {
  const config = getInstagramConfig();

  if (!config) {
    throw new Error("Instagram publishing is not configured");
  }

  const body = new URLSearchParams({
    ...payload,
    access_token: config.accessToken!,
  });

  const response = await fetchWithTimeout(
    `https://graph.instagram.com/${config.graphApiVersion}${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      timeoutMs: 30_000,
    },
  );

  if (!response.ok) {
    throw new Error(await readGraphError(response));
  }

  return (await response.json()) as T;
}

async function getGraphJson<T>(path: string, params: Record<string, string>) {
  const config = getInstagramConfig();

  if (!config) {
    throw new Error("Instagram publishing is not configured");
  }

  const url = new URL(`https://graph.instagram.com/${config.graphApiVersion}${path}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  url.searchParams.set("access_token", config.accessToken!);

  const response = await fetchWithTimeout(url, {
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    throw new Error(await readGraphError(response));
  }

  return (await response.json()) as T;
}

async function updateInstagramMetadata(
  submissionId: string,
  updates: Partial<InstagramPublishMetadata>,
) {
  const supabase = getSupabaseAdminClient();
  const { data: currentSubmission, error: currentSubmissionError } = await supabase
    .from("submissions")
    .select("id, ai_metadata")
    .eq("id", submissionId)
    .single();

  if (currentSubmissionError || !currentSubmission) {
    throw new Error("Submission not found");
  }

  const { error } = await supabase
    .from("submissions")
    .update({
      ai_metadata: mergeInstagramPublishMetadata(
        currentSubmission.ai_metadata as Record<string, unknown> | null,
        updates,
      ),
    })
    .eq("id", submissionId);

  if (error) {
    throw new Error(error.message);
  }
}

async function loadSubmission(submissionId: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("submissions")
    .select(
      `
        id,
        status,
        caption,
        hashtags,
        target_menu_name,
        appeal_point,
        extra_message,
        ai_metadata,
        generation_jobs (
          id,
          status,
          model_name,
          result_asset_id,
          created_at
        ),
        submission_assets (
          id,
          asset_type,
          storage_bucket,
          file_path,
          file_name,
          mime_type,
          created_at
        )
      `,
    )
    .eq("id", submissionId)
    .single<InstagramSubmissionRow>();

  if (error || !data) {
    throw new Error("Submission not found");
  }

  return data;
}

function resolveInstagramMediaType(
  submission: InstagramSubmissionRow,
  mediaType?: InstagramMediaType,
): InstagramMediaType {
  if (mediaType) {
    return mediaType;
  }

  const videoStatus = getVideoPublishRequestStatus(submission.ai_metadata);
  const photoStatus = getPhotoPublishRequestStatus(submission.ai_metadata);

  if (videoStatus === "requested_publish" || videoStatus === "approved") {
    return "video";
  }

  if (photoStatus === "requested_publish" || photoStatus === "approved") {
    return "photo";
  }

  const hasVideoAsset = (submission.submission_assets ?? []).some(
    (asset) => asset.asset_type === "generated_video",
  );

  return hasVideoAsset ? "video" : "photo";
}

function pickAssetForInstagram(
  submission: InstagramSubmissionRow,
  mediaType: InstagramMediaType,
) {
  const jobs = [...(submission.generation_jobs ?? [])].sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  );
  const assets = submission.submission_assets ?? [];

  const relevantJob = jobs.find((job) => {
    if (job.status !== "completed" || !job.result_asset_id) {
      return false;
    }

    return mediaType === "video"
      ? job.model_name.startsWith("veo")
      : !job.model_name.startsWith("veo");
  });

  if (relevantJob?.result_asset_id) {
    const matchedAsset = assets.find((asset) => asset.id === relevantJob.result_asset_id);
    if (matchedAsset) {
      return matchedAsset;
    }
  }

  const targetAssetType = mediaType === "video" ? "generated_video" : "generated_image";

  return [...assets]
    .filter((asset) => asset.asset_type === targetAssetType)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;
}

async function createSignedAssetUrl(bucket: string, filePath: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(filePath, 60 * 60 * 6);

  if (error || !data?.signedUrl) {
    throw new Error("Failed to create signed asset URL");
  }

  return data.signedUrl;
}

async function publishInstagramMedia(
  mediaType: InstagramMediaType,
  mediaUrl: string,
  caption: string | null,
) {
  const config = getInstagramConfig();

  if (!config) {
    throw new Error("Instagram publishing is not configured");
  }

  if (mediaType === "photo") {
    const container = await postGraphForm<{ id: string }>(
      `/${config.igUserId}/media`,
      {
        image_url: mediaUrl,
        ...(caption ? { caption } : {}),
      },
    );

    return {
      containerId: container.id,
      publishedMediaId: null,
      status: "processing" as const,
      containerStatusCode: "IN_PROGRESS",
    };
  }

  const container = await postGraphForm<{ id: string }>(
    `/${config.igUserId}/media`,
    {
      media_type: "REELS",
      video_url: mediaUrl,
      ...(caption ? { caption } : {}),
    },
  );

  return {
    containerId: container.id,
    publishedMediaId: null,
    status: "processing" as const,
    containerStatusCode: "IN_PROGRESS",
  };
}

async function publishInstagramContainer(
  submissionId: string,
  containerId: string,
  mediaType: InstagramMediaType,
) {
  const config = getInstagramConfig();

  if (!config) {
    throw new Error("Instagram publishing is not configured");
  }

  const containerStatus = await getGraphJson<InstagramContainerStatus>(
    `/${containerId}`,
    {
      fields: "status_code,status",
    },
  );

  const statusCode = containerStatus.status_code ?? null;
  const checkedAt = new Date().toISOString();

  if (statusCode === "FINISHED") {
    const published = await postGraphForm<{ id: string }>(
      `/${config.igUserId}/media_publish`,
      {
        creation_id: containerId,
      },
    );

    await updateInstagramMetadata(submissionId, {
      status: "published",
      publishedMediaId: published.id,
      containerStatusCode: statusCode,
      publishedAt: checkedAt,
      lastCheckedAt: checkedAt,
      lastError: null,
    });

    return {
      ok: true,
      submissionId,
      mediaType,
      status: "published" as const,
      containerId,
      publishedMediaId: published.id,
      caption: null,
      lastError: null,
    };
  }

  if (statusCode === "ERROR" || statusCode === "EXPIRED") {
    const message = `Instagram ${mediaType} container ended with status ${statusCode}`;

    await updateInstagramMetadata(submissionId, {
      status: "failed",
      containerStatusCode: statusCode,
      lastCheckedAt: checkedAt,
      lastError: message,
    });

    return {
      ok: false,
      submissionId,
      mediaType,
      status: "failed" as const,
      containerId,
      publishedMediaId: null,
      caption: null,
      lastError: message,
    };
  }

  await updateInstagramMetadata(submissionId, {
    status: "processing",
    containerStatusCode: statusCode,
    lastCheckedAt: checkedAt,
    lastError: null,
  });

  return {
    ok: true,
    submissionId,
    mediaType,
    status: "processing" as const,
    containerId,
    publishedMediaId: null,
    caption: null,
    lastError: null,
  };
}

export function isInstagramConfigured() {
  return Boolean(getInstagramConfig());
}

export async function startInstagramPublishForSubmission(
  submissionId: string,
  options?: {
    mediaType?: InstagramMediaType;
    captionOverride?: string;
  },
): Promise<InstagramPublishResult> {
  if (!isInstagramConfigured()) {
    throw new Error("Instagram publishing is not configured");
  }

  const submission = await loadSubmission(submissionId);

  if (submission.status !== "approved") {
    throw new Error("Only approved submissions can be published to Instagram");
  }

  const mediaType = resolveInstagramMediaType(submission, options?.mediaType);
  const asset = pickAssetForInstagram(submission, mediaType);

  if (!asset) {
    throw new Error(`No generated ${mediaType} asset is available`);
  }

  const requestedAt = new Date().toISOString();
  const caption = options?.captionOverride?.trim() || buildInstagramCaption(submission);
  const mediaUrl = await createSignedAssetUrl(asset.storage_bucket, asset.file_path);

  await updateInstagramMetadata(submissionId, {
    mediaType,
    status: "processing",
    containerId: null,
    publishedMediaId: null,
    caption,
    assetId: asset.id,
    assetPath: asset.file_path,
    requestedAt,
    publishedAt: null,
    lastCheckedAt: null,
    lastError: null,
    containerStatusCode: null,
  });

  try {
    const result = await publishInstagramMedia(mediaType, mediaUrl, caption);

    await updateInstagramMetadata(submissionId, {
      mediaType,
      status: result.status,
      containerId: result.containerId,
      publishedMediaId: result.publishedMediaId,
      caption,
      assetId: asset.id,
      assetPath: asset.file_path,
      requestedAt,
      publishedAt: null,
      lastCheckedAt: new Date().toISOString(),
      lastError: null,
      containerStatusCode: result.containerStatusCode,
    });

    return {
      ok: true,
      submissionId,
      mediaType,
      status: result.status,
      containerId: result.containerId,
      publishedMediaId: result.publishedMediaId,
      caption,
      lastError: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Instagram publish error";

    await updateInstagramMetadata(submissionId, {
      mediaType,
      status: "failed",
      caption,
      assetId: asset.id,
      assetPath: asset.file_path,
      requestedAt,
      lastError: message,
      lastCheckedAt: new Date().toISOString(),
    });

    return {
      ok: false,
      submissionId,
      mediaType,
      status: "failed",
      containerId: null,
      publishedMediaId: null,
      caption,
      lastError: message,
    };
  }
}

export async function syncInstagramPublishForSubmission(
  submissionId: string,
): Promise<InstagramPublishResult> {
  if (!isInstagramConfigured()) {
    throw new Error("Instagram publishing is not configured");
  }

  const submission = await loadSubmission(submissionId);
  const instagramPublish = getInstagramPublishMetadata(submission.ai_metadata);

  if (!instagramPublish.containerId || !instagramPublish.mediaType) {
    throw new Error("Instagram publish job not found");
  }

  if (instagramPublish.publishedMediaId || instagramPublish.publishedAt) {
    return {
      ok: true,
      submissionId,
      mediaType: instagramPublish.mediaType,
      status: "published",
      containerId: instagramPublish.containerId,
      publishedMediaId: instagramPublish.publishedMediaId ?? null,
      caption: instagramPublish.caption ?? null,
      lastError: null,
    };
  }

  return instagramPublish.mediaType === "photo"
    ? publishInstagramContainer(submissionId, instagramPublish.containerId, "photo")
    : publishInstagramContainer(submissionId, instagramPublish.containerId, "video");
}

export async function waitForInstagramPublishCompletion(
  submissionId: string,
  options?: WaitForInstagramPublishCompletionOptions,
): Promise<InstagramPublishResult> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const delayMs = Math.max(0, options?.delayMs ?? 2_000);

  let latestResult = await syncInstagramPublishForSubmission(submissionId);

  for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
    if (latestResult.status !== "processing") {
      return latestResult;
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }

    latestResult = await syncInstagramPublishForSubmission(submissionId);
  }

  return latestResult;
}
