import type { SupabaseClient } from "@supabase/supabase-js";

export const GENERATION_STAGES = {
  queued: { percent: 0, message: "생성 순서를 기다리고 있어요." },
  preparing: { percent: 10, message: "사진과 영상을 준비하고 있어요." },
  scripting: { percent: 25, message: "AI가 문구와 구성을 만들고 있어요." },
  designing: { percent: 40, message: "디자인과 장면 구성을 준비했어요." },
  rendering: { percent: 60, message: "이미지와 영상을 만들고 있어요." },
  uploading: { percent: 80, message: "완성된 파일을 업로드하고 있어요." },
  saving: { percent: 95, message: "보관함에 결과를 저장하고 있어요." },
  completed: { percent: 100, message: "생성이 완료됐어요." },
} as const;
export type GenerationStage = keyof typeof GENERATION_STAGES;
export type ProgressReporter = (stage: Exclude<GenerationStage, "queued" | "completed">) => Promise<void>;

/** Stage weights describe milestones, rather than elapsed time or byte-level completion. */
export function createProgressReporter(client: SupabaseClient, jobId: string): ProgressReporter {
  let lastPercent = -1;
  return async stage => {
    const progress = { ...GENERATION_STAGES[stage], stage, estimated: true };
    if (progress.percent <= lastPercent) return;
    const { error } = await client.from("generation_jobs").update({ progress }).eq("id", jobId).eq("status", "processing");
    if (error) {
      console.error("Unable to update generation progress", { jobId, stage });
      return;
    }
    lastPercent = progress.percent;
  };
}

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
  estimated?: unknown;
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
  const stage = status === "failed" ? "failed" : text(progress.stage) ?? (status === "queued" ? "queued" : "processing");
  const message = status === "failed" ? "생성에 실패했어요." : text(progress.message);
  const explicitPercent = integer(progress.percent);
  const current = integer(progress.current);
  const total = integer(progress.total);

  if (explicitPercent !== null) {
    return { percent: Math.min(99, clamp(explicitPercent)), estimated: progress.estimated === true, stage, message };
  }

  if (current !== null && total !== null && total > 0) {
    return { percent: Math.min(99, clamp(Math.round((current / total) * 100))), estimated: false, stage, message };
  }

  if (status === "queued") {
    return { percent: 0, estimated: false, stage, message: message ?? "생성 요청을 준비하고 있어요." };
  }

  if (status === "failed") {
    return { percent: 0, estimated: false, stage, message: message ?? "생성에 실패했어요." };
  }

  return { percent: 10, estimated: true, stage, message: message ?? "생성 작업을 준비하고 있어요." };
}

export function getGenerationContentType(modelName: string | null) {
  return modelName?.startsWith("veo") || ["postalk-reels", "render-quote-video", "render-exhibition-video"].includes(modelName ?? "")
    ? "reels" as const
    : "cardNews" as const;
}
