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
  assetIds?: string[] | null;
  assetPaths?: string[] | null;
  publishMode?: "single" | "carousel" | null;
  carouselItemCount?: number | null;
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
        style_preset: string;
        result_asset_id: string | null;
        result_storage_bucket: string | null;
        result_file_path: string | null;
        result_payload: Record<string, unknown> | null;
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
  publishMode?: "single" | "carousel";
  carouselItemCount?: number;
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

function normalizePublishMode(
  value: unknown,
): "single" | "carousel" | undefined {
  if (value === "carousel") {
    return "carousel";
  }

  if (value === "single") {
    return "single";
  }

  return undefined;
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
          style_preset,
          result_asset_id,
          result_storage_bucket,
          result_file_path,
          result_payload,
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

type InstagramPublishAsset = {
  id: string;
  asset_type: string;
  storage_bucket: string;
  file_path: string;
  file_name: string | null;
  mime_type: string | null;
  created_at: string;
};

type InstagramPublishAssetSelection = {
  publishMode: "single" | "carousel";
  assets: InstagramPublishAsset[];
  sourceJobId: string | null;
};

function resolveCarouselAssetsFromJob(
  submission: InstagramSubmissionRow,
  relevantJob: NonNullable<InstagramSubmissionRow["generation_jobs"]>[number] | undefined,
) {
  const assets = submission.submission_assets ?? [];

  if (!relevantJob || !relevantJob.result_payload || typeof relevantJob.result_payload !== "object") {
    return null;
  }

  const generatedImages = Array.isArray(relevantJob.result_payload.generatedImages)
    ? relevantJob.result_payload.generatedImages
    : null;

  if (!generatedImages || generatedImages.length <= 1) {
    return null;
  }

  const resolvedAssets = generatedImages
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const assetId = typeof record.assetId === "string" ? record.assetId : null;
      const filePath = typeof record.filePath === "string" ? record.filePath : null;

      return (
        assets.find((asset) => assetId && asset.id === assetId) ??
        assets.find((asset) => filePath && asset.file_path === filePath) ??
        null
      );
    })
    .filter((asset): asset is InstagramPublishAsset => Boolean(asset));

  return resolvedAssets.length > 1 ? resolvedAssets : null;
}

function pickAssetsForInstagram(
  submission: InstagramSubmissionRow,
  mediaType: InstagramMediaType,
): InstagramPublishAssetSelection | null {
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

  if (mediaType === "photo") {
    const carouselAssets = resolveCarouselAssetsFromJob(submission, relevantJob);

    if (carouselAssets) {
      return {
        publishMode: "carousel",
        assets: carouselAssets,
        sourceJobId: relevantJob?.id ?? null,
      };
    }
  }

  if (relevantJob?.result_asset_id) {
    const matchedAsset = assets.find((asset) => asset.id === relevantJob.result_asset_id);
    if (matchedAsset) {
      return {
        publishMode: "single",
        assets: [matchedAsset],
        sourceJobId: relevantJob.id,
      };
    }
  }

  const targetAssetType = mediaType === "video" ? "generated_video" : "generated_image";
  const fallbackAsset = [...assets]
    .filter((asset) => asset.asset_type === targetAssetType)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;

  if (!fallbackAsset) {
    return null;
  }

  return {
    publishMode: "single",
    assets: [fallbackAsset],
    sourceJobId: null,
  };
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
  mediaUrls: string[],
  caption: string | null,
) {
  const config = getInstagramConfig();

  if (!config) {
    throw new Error("Instagram publishing is not configured");
  }

  if (mediaType === "photo") {
    if (mediaUrls.length > 1) {
      const childContainerIds: string[] = [];

      for (const mediaUrl of mediaUrls) {
        const child = await postGraphForm<{ id: string }>(
          `/${config.igUserId}/media`,
          {
            image_url: mediaUrl,
            is_carousel_item: "true",
          },
        );

        childContainerIds.push(child.id);
      }

      const carousel = await postGraphForm<{ id: string }>(
        `/${config.igUserId}/media`,
        {
          media_type: "CAROUSEL",
          children: childContainerIds.join(","),
          ...(caption ? { caption } : {}),
        },
      );

      return {
        publishMode: "carousel" as const,
        carouselItemCount: mediaUrls.length,
        containerId: carousel.id,
        publishedMediaId: null,
        status: "processing" as const,
        containerStatusCode: "IN_PROGRESS",
      };
    }

    const container = await postGraphForm<{ id: string }>(
      `/${config.igUserId}/media`,
      {
        image_url: mediaUrls[0]!,
        ...(caption ? { caption } : {}),
      },
    );

    return {
      publishMode: "single" as const,
      carouselItemCount: 1,
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
      video_url: mediaUrls[0]!,
      ...(caption ? { caption } : {}),
    },
  );

  return {
    publishMode: "single" as const,
    carouselItemCount: 1,
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
  instagramPublish: InstagramPublishMetadata,
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
      publishMode: normalizePublishMode(instagramPublish.publishMode) ?? "single",
      carouselItemCount:
        typeof instagramPublish.carouselItemCount === "number"
          ? instagramPublish.carouselItemCount
          : undefined,
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
      publishMode: normalizePublishMode(instagramPublish.publishMode) ?? "single",
      carouselItemCount:
        typeof instagramPublish.carouselItemCount === "number"
          ? instagramPublish.carouselItemCount
          : undefined,
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
    publishMode: normalizePublishMode(instagramPublish.publishMode) ?? "single",
    carouselItemCount:
      typeof instagramPublish.carouselItemCount === "number"
        ? instagramPublish.carouselItemCount
        : undefined,
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
  const assetSelection = pickAssetsForInstagram(submission, mediaType);

  if (!assetSelection || assetSelection.assets.length === 0) {
    throw new Error(`No generated ${mediaType} asset is available`);
  }

  const requestedAt = new Date().toISOString();
  const caption = options?.captionOverride?.trim() || buildInstagramCaption(submission);
  const mediaUrls = await Promise.all(
    assetSelection.assets.map((asset) =>
      createSignedAssetUrl(asset.storage_bucket, asset.file_path),
    ),
  );

  await updateInstagramMetadata(submissionId, {
    mediaType,
    status: "processing",
    containerId: null,
    publishedMediaId: null,
    caption,
    assetId: assetSelection.assets[0]?.id ?? null,
    assetPath: assetSelection.assets[0]?.file_path ?? null,
    assetIds: assetSelection.assets.map((asset) => asset.id),
    assetPaths: assetSelection.assets.map((asset) => asset.file_path),
    publishMode: assetSelection.publishMode,
    carouselItemCount: assetSelection.assets.length,
    requestedAt,
    publishedAt: null,
    lastCheckedAt: null,
    lastError: null,
    containerStatusCode: null,
  });

  try {
    const result = await publishInstagramMedia(mediaType, mediaUrls, caption);

    await updateInstagramMetadata(submissionId, {
      mediaType,
      status: result.status,
      containerId: result.containerId,
      publishedMediaId: result.publishedMediaId,
      caption,
      assetId: assetSelection.assets[0]?.id ?? null,
      assetPath: assetSelection.assets[0]?.file_path ?? null,
      assetIds: assetSelection.assets.map((asset) => asset.id),
      assetPaths: assetSelection.assets.map((asset) => asset.file_path),
      publishMode: result.publishMode,
      carouselItemCount: result.carouselItemCount,
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
      publishMode: result.publishMode,
      carouselItemCount: result.carouselItemCount,
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
      assetId: assetSelection.assets[0]?.id ?? null,
      assetPath: assetSelection.assets[0]?.file_path ?? null,
      assetIds: assetSelection.assets.map((asset) => asset.id),
      assetPaths: assetSelection.assets.map((asset) => asset.file_path),
      publishMode: assetSelection.publishMode,
      carouselItemCount: assetSelection.assets.length,
      requestedAt,
      lastError: message,
      lastCheckedAt: new Date().toISOString(),
    });

    return {
      ok: false,
      submissionId,
      mediaType,
      status: "failed",
      publishMode: assetSelection.publishMode,
      carouselItemCount: assetSelection.assets.length,
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
      publishMode: normalizePublishMode(instagramPublish.publishMode) ?? "single",
      carouselItemCount:
        typeof instagramPublish.carouselItemCount === "number"
          ? instagramPublish.carouselItemCount
          : undefined,
      containerId: instagramPublish.containerId,
      publishedMediaId: instagramPublish.publishedMediaId ?? null,
      caption: instagramPublish.caption ?? null,
      lastError: null,
    };
  }

  return instagramPublish.mediaType === "photo"
    ? publishInstagramContainer(
        submissionId,
        instagramPublish.containerId,
        "photo",
        instagramPublish,
      )
    : publishInstagramContainer(
        submissionId,
        instagramPublish.containerId,
        "video",
        instagramPublish,
      );
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
