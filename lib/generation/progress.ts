export type GenerationProgress = {
  percent: number;
  estimated: boolean;
  stage: string;
  message: string | null;
};

type JobProgress = {
  stage?: unknown;
  current?: unknown;
  total?: unknown;
  message?: unknown;
  percent?: unknown;
};

function integer(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

/** Normalizes provider-specific job progress for the merchant UI. */
export function getGenerationProgress(status: string, raw: unknown): GenerationProgress {
  if (status === "completed") {
    return { percent: 100, estimated: false, stage: "completed", message: "생성이 완료됐어요." };
  }

  const progress = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as JobProgress
    : {};
  const stage = text(progress.stage) ?? (status === "queued" ? "queued" : status === "failed" ? "failed" : "processing");
  const message = text(progress.message);
  const explicitPercent = integer(progress.percent);
  const current = integer(progress.current);
  const total = integer(progress.total);

  if (explicitPercent !== null) {
    return { percent: clamp(explicitPercent), estimated: false, stage, message };
  }

  if (current !== null && total !== null && total > 0) {
    return { percent: clamp(Math.round((current / total) * 100)), estimated: false, stage, message };
  }

  if (status === "queued") {
    return { percent: 0, estimated: false, stage, message: message ?? "생성 요청을 준비하고 있어요." };
  }

  if (status === "failed") {
    return { percent: 0, estimated: false, stage, message: message ?? "생성에 실패했어요." };
  }

  return { percent: 50, estimated: true, stage, message: message ?? "생성 작업을 처리하고 있어요." };
}

export function getGenerationContentType(modelName: string | null) {
  return modelName?.startsWith("veo") || ["postalk-reels", "render-quote-video", "render-exhibition-video"].includes(modelName ?? "")
    ? "reels" as const
    : "cardNews" as const;
}
