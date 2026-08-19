import { getInstagramEnv } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

import { getInstagramPublishMetadata } from "./publish";

export type InstagramMetricsMetadata = {
  mediaId?: string | null;
  permalink?: string | null;
  mediaType?: string | null;
  mediaProductType?: string | null;
  likeCount?: number | null;
  commentsCount?: number | null;
  views?: number | null;
  reach?: number | null;
  impressions?: number | null;
  fetchedAt?: string | null;
  lastError?: string | null;
};

type InstagramMediaSummary = {
  id?: string;
  permalink?: string;
  media_type?: string;
  media_product_type?: string;
  like_count?: number;
  comments_count?: number;
};

type InstagramInsightsResponse = {
  data?: Array<{
    name?: string;
    values?: Array<{
      value?: number;
    }>;
  }>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getInstagramConfig() {
  const env = getInstagramEnv();

  if (!env.accessToken || !env.igUserId) {
    return null;
  }

  return env;
}

async function readGraphError(response: Response) {
  const text = await response.text();

  try {
    const json = JSON.parse(text) as {
      error?: { message?: string };
    };
    return json.error?.message ?? text;
  } catch {
    return text;
  }
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

function getInstagramMetricsMetadata(
  aiMetadata: Record<string, unknown> | null | undefined,
): InstagramMetricsMetadata {
  if (!isObject(aiMetadata) || !isObject(aiMetadata.instagramMetrics)) {
    return {};
  }

  return aiMetadata.instagramMetrics as InstagramMetricsMetadata;
}

function mergeInstagramMetricsMetadata(
  aiMetadata: Record<string, unknown> | null | undefined,
  updates: Partial<InstagramMetricsMetadata>,
) {
  const base = isObject(aiMetadata) ? aiMetadata : {};
  const current = getInstagramMetricsMetadata(aiMetadata);

  return {
    ...base,
    instagramMetrics: {
      ...current,
      ...updates,
    },
  };
}

async function updateInstagramMetricsMetadata(
  submissionId: string,
  updates: Partial<InstagramMetricsMetadata>,
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
      ai_metadata: mergeInstagramMetricsMetadata(
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
    .select("id, ai_metadata")
    .eq("id", submissionId)
    .single();

  if (error || !data) {
    throw new Error("Submission not found");
  }

  return data;
}

async function fetchInstagramMetricValue(
  mediaId: string,
  metric: "views" | "reach" | "impressions",
) {
  const response = await getGraphJson<InstagramInsightsResponse>(
    `/${mediaId}/insights`,
    {
      metric,
    },
  );

  const metricItem = response.data?.find((item) => item.name === metric);
  const value = metricItem?.values?.[0]?.value;

  return typeof value === "number" ? value : null;
}

export async function getStoredInstagramMetricsForSubmission(submissionId: string) {
  const submission = await loadSubmission(submissionId);
  return getInstagramMetricsMetadata(
    submission.ai_metadata as Record<string, unknown> | null,
  );
}

export async function refreshInstagramMetricsForSubmission(submissionId: string) {
  const submission = await loadSubmission(submissionId);
  const aiMetadata = submission.ai_metadata as Record<string, unknown> | null;
  const instagramPublish = getInstagramPublishMetadata(aiMetadata);

  if (!instagramPublish.publishedMediaId) {
    throw new Error("Instagram published media not found");
  }

  const fetchedAt = new Date().toISOString();
  const mediaId = instagramPublish.publishedMediaId;
  const mediaSummary = await getGraphJson<InstagramMediaSummary>(`/${mediaId}`, {
    fields:
      "id,permalink,media_type,media_product_type,like_count,comments_count",
  });

  let views: number | null = null;
  let reach: number | null = null;
  let impressions: number | null = null;
  const insightErrors: string[] = [];

  for (const metric of ["views", "reach", "impressions"] as const) {
    try {
      const value = await fetchInstagramMetricValue(mediaId, metric);

      if (metric === "views") {
        views = value;
      } else if (metric === "reach") {
        reach = value;
      } else {
        impressions = value;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `${metric} unavailable`;
      insightErrors.push(`${metric}: ${message}`);
    }
  }

  const metrics: InstagramMetricsMetadata = {
    mediaId: mediaSummary.id ?? mediaId,
    permalink: mediaSummary.permalink ?? null,
    mediaType: mediaSummary.media_type ?? instagramPublish.mediaType ?? null,
    mediaProductType: mediaSummary.media_product_type ?? null,
    likeCount:
      typeof mediaSummary.like_count === "number" ? mediaSummary.like_count : null,
    commentsCount:
      typeof mediaSummary.comments_count === "number"
        ? mediaSummary.comments_count
        : null,
    views,
    reach,
    impressions,
    fetchedAt,
    lastError: insightErrors.length > 0 ? insightErrors.join(" | ") : null,
  };

  await updateInstagramMetricsMetadata(submissionId, metrics);

  return metrics;
}
