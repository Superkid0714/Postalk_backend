import { getOpenAiApiKey } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http";
import {
  findPhotoGuideShot,
  getPhotoGuideByCategory,
} from "@/lib/photo-guides";
import type { StoreCategoryCode } from "@/lib/store-categories";
import type { SupabaseClient } from "@supabase/supabase-js";

type ReviewCheckStatus = "pass" | "warning" | "fail" | "not_applicable";

type OpenAiResponsesResponse = {
  output_text?: string;
};

export type PhotoReviewCheckResult = {
  focus: ReviewCheckStatus;
  brightness: ReviewCheckStatus;
  framing: ReviewCheckStatus;
  subjectVisibility: ReviewCheckStatus;
  guideMatch: ReviewCheckStatus;
  textReadability: ReviewCheckStatus;
};

export type PhotoReviewResult = {
  passed: boolean;
  score: number;
  recommendedAction: "proceed" | "retake";
  summary: string;
  feedback: string[];
  checks: PhotoReviewCheckResult;
};

function hasCriticalMenuBoardFailure(checks: PhotoReviewCheckResult) {
  return (
    checks.focus === "fail" ||
    checks.subjectVisibility === "fail" ||
    checks.textReadability === "fail"
  );
}

function applyAssetSpecificReviewHeuristics(
  assetType: "menu_board" | "food_photo",
  review: PhotoReviewResult,
): PhotoReviewResult {
  if (assetType !== "menu_board") {
    return review;
  }

  if (hasCriticalMenuBoardFailure(review.checks)) {
    return {
      ...review,
      passed: false,
      recommendedAction: "retake",
    };
  }

  const softWarnings = [
    review.checks.brightness,
    review.checks.framing,
    review.checks.guideMatch,
  ].filter((value) => value === "warning" || value === "fail").length;

  const canProceed =
    review.checks.focus !== "fail" &&
    review.checks.subjectVisibility !== "fail" &&
    review.checks.textReadability !== "fail" &&
    review.score >= 55 &&
    softWarnings <= 2;

  if (!review.passed && canProceed) {
    return {
      ...review,
      passed: true,
      score: Math.max(review.score, 60),
      recommendedAction: "proceed",
      summary: "메뉴판으로 활용 가능한 수준이라 다음 단계로 진행합니다.",
      feedback:
        review.feedback.length > 0
          ? review.feedback
          : ["메뉴와 가격이 전반적으로 보여서 다음 단계로 진행할 수 있습니다."],
    };
  }

  return review;
}

function buildFallbackReviewResult(reason: string): PhotoReviewResult {
  return {
    passed: false,
    score: 0,
    recommendedAction: "retake",
    summary: "사진 판독이 불안정해 재촬영을 권장합니다.",
    feedback: [
      "사진을 다시 한 번 또렷하게 촬영해주세요.",
      "피사체가 화면 중앙에 잘 보이도록 맞춰주세요.",
      `검수 참고: ${reason}`,
    ],
    checks: {
      focus: "warning",
      brightness: "warning",
      framing: "warning",
      subjectVisibility: "warning",
      guideMatch: "warning",
      textReadability: "not_applicable",
    },
  };
}

type ReviewPhotoAssetParams = {
  supabase: SupabaseClient;
  bucket: string;
  filePath: string;
  assetType: "menu_board" | "food_photo";
  category: StoreCategoryCode;
  shotOrder?: number | null;
};

function stripCodeFence(value: string) {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function normalizeCheckStatus(value: unknown): ReviewCheckStatus {
  if (
    value === "pass" ||
    value === "warning" ||
    value === "fail" ||
    value === "not_applicable"
  ) {
    return value;
  }

  return "not_applicable";
}

function normalizeReviewResult(value: unknown): PhotoReviewResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const checks =
    record.checks && typeof record.checks === "object" && !Array.isArray(record.checks)
      ? (record.checks as Record<string, unknown>)
      : {};
  const feedback = Array.isArray(record.feedback)
    ? record.feedback
        .filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
        .map((item) => item.trim())
        .slice(0, 5)
    : [];
  const score =
    typeof record.score === "number" && Number.isFinite(record.score)
      ? Math.min(100, Math.max(0, Math.round(record.score)))
      : 0;
  const passed = typeof record.passed === "boolean" ? record.passed : score >= 70;
  const summary =
    typeof record.summary === "string" && record.summary.trim().length > 0
      ? record.summary.trim()
      : passed
        ? "사진 품질이 기준을 충족합니다."
        : "재촬영을 권장합니다.";

  return {
    passed,
    score,
    recommendedAction:
      record.recommendedAction === "retake" || !passed ? "retake" : "proceed",
    summary,
    feedback,
    checks: {
      focus: normalizeCheckStatus(checks.focus),
      brightness: normalizeCheckStatus(checks.brightness),
      framing: normalizeCheckStatus(checks.framing),
      subjectVisibility: normalizeCheckStatus(checks.subjectVisibility),
      guideMatch: normalizeCheckStatus(checks.guideMatch),
      textReadability: normalizeCheckStatus(checks.textReadability),
    },
  };
}

function inferMimeType(filePath: string, fallback: string | null) {
  if (fallback && fallback.trim().length > 0) {
    return fallback;
  }

  const lowerPath = filePath.toLowerCase();

  if (lowerPath.endsWith(".png")) {
    return "image/png";
  }

  if (lowerPath.endsWith(".webp")) {
    return "image/webp";
  }

  return "image/jpeg";
}

function buildPhotoReviewPrompt(params: {
  category: StoreCategoryCode;
  assetType: "menu_board" | "food_photo";
  shotOrder?: number | null;
}) {
  const guide = getPhotoGuideByCategory(params.category);
  const targetShot =
    typeof params.shotOrder === "number"
      ? findPhotoGuideShot(params.category, params.shotOrder)
      : null;

  return [
    "You are reviewing a merchant photo for a Korean traditional-market advertising workflow.",
    "Return strict JSON only.",
    "Judge whether this photo is good enough to keep or should be retaken.",
    "Be strict but practical. Focus on whether the photo is usable for an ad-making workflow on mobile.",
    params.assetType === "menu_board"
      ? "For menu boards, do not require every tiny line to be perfectly readable. Pass if representative menu names and prices are mostly readable and the board is clearly captured."
      : "For food photos, require a clearly visible subject and an appealing composition.",
    "Return JSON keys only: passed, score, recommendedAction, summary, feedback, checks.",
    "checks must include: focus, brightness, framing, subjectVisibility, guideMatch, textReadability.",
    "Each check value must be one of: pass, warning, fail, not_applicable.",
    "Use textReadability only when the image is a menu board or when text clarity matters. Otherwise return not_applicable.",
    "feedback must be 1 to 3 short Korean sentences for the merchant.",
    "summary must be one short Korean sentence.",
    "recommendedAction must be proceed or retake.",
    `Store category: ${params.category}`,
    `Asset type: ${params.assetType}`,
    targetShot
      ? `Target shot: ${targetShot.order}. ${targetShot.title} - ${targetShot.description}`
      : "Target shot: generic quality review without a specific shot target.",
    "[CATEGORY PHOTO GUIDE]",
    JSON.stringify(guide, null, 2),
    "Review priorities:",
    "- Is the image sharp enough?",
    "- Is the subject clearly visible and not cut awkwardly?",
    "- Is the image too dark or too blown out?",
    "- Does the image match the requested shot guidance?",
    "- If menu text should be readable, can a user actually read the main menu names and prices well enough?",
    params.assetType === "menu_board"
      ? "- For menu boards, readability of the main sections and representative items matters more than perfect OCR-level clarity."
      : "- For food photos, prioritize subject clarity and framing over text.",
    "- Do not invent store facts. Only review image quality and guidance match.",
  ].join("\n");
}

export async function reviewPhotoAsset(
  params: ReviewPhotoAssetParams,
): Promise<PhotoReviewResult> {
  const apiKey = getOpenAiApiKey();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const { data, error } = await params.supabase.storage
    .from(params.bucket)
    .download(params.filePath);

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to download review image");
  }

  const bytes = Buffer.from(await data.arrayBuffer());
  const mimeType = inferMimeType(params.filePath, data.type ?? null);
  const dataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;

  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildPhotoReviewPrompt({
                category: params.category,
                assetType: params.assetType,
                shotOrder: params.shotOrder ?? null,
              }),
            },
            {
              type: "input_image",
              image_url: dataUrl,
            },
          ],
        },
      ],
    }),
    timeoutMs: 60_000,
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(`Photo review failed: ${errorText}`);
  }

  const json = (await response.json()) as OpenAiResponsesResponse;
  const outputText =
    typeof json.output_text === "string" ? stripCodeFence(json.output_text) : "";

  if (!outputText) {
    return buildFallbackReviewResult("Photo review returned empty output");
  }

  try {
    const parsed = normalizeReviewResult(JSON.parse(outputText));

    if (!parsed) {
      return buildFallbackReviewResult(
        "Photo review returned invalid JSON structure",
      );
    }

    return applyAssetSpecificReviewHeuristics(params.assetType, parsed);
  } catch {
    return buildFallbackReviewResult("Photo review returned invalid JSON");
  }
}
