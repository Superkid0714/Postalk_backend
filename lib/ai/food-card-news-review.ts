import { getOpenAiApiKey } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http";

import type { SubmissionForGeneration } from "@/lib/ai/generation";
import type {
  FoodCardNewsCreativePlan,
  FoodCardNewsPlanCard,
} from "@/lib/ai/food-card-news";

export type FoodCardNewsSourceSlotKey =
  | "menuBoard"
  | "coverPhoto"
  | "flatlayPhoto"
  | "detailPhoto"
  | "cookingPhoto"
  | "infoPhoto";

export type ReviewedFoodCardNewsCard = {
  index: number;
  cardKey: FoodCardNewsPlanCard["key"];
  title: string;
  subtitle: string;
  body: string[];
  selectedSlot: FoodCardNewsSourceSlotKey;
  reason: string;
};

export type ReviewedFoodCardNewsPlan = {
  concept: string;
  tone: string;
  cards: ReviewedFoodCardNewsCard[];
};

type OpenAiResponsesResponse = {
  output_text?: string;
};

const CARD_SLOT_PRIORITY: Record<
  FoodCardNewsPlanCard["key"],
  FoodCardNewsSourceSlotKey[]
> = {
  cover_vertical_still_life: ["coverPhoto", "detailPhoto", "flatlayPhoto"],
  dark_flatlay_editorial: ["flatlayPhoto", "coverPhoto", "infoPhoto"],
  circular_editorial_layout: ["detailPhoto", "cookingPhoto", "coverPhoto"],
  vertical_quote_band: ["cookingPhoto", "detailPhoto", "coverPhoto"],
  closing_information: ["infoPhoto", "menuBoard", "flatlayPhoto"],
};

const SOURCE_SLOT_KEYS: FoodCardNewsSourceSlotKey[] = [
  "menuBoard",
  "coverPhoto",
  "flatlayPhoto",
  "detailPhoto",
  "cookingPhoto",
  "infoPhoto",
];

function compactText(value: string | null | undefined, fallback: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }

  return value.trim();
}

function cleanInlineLabel(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value
    .replace(/^(주력 메뉴를 포함한 대표 메뉴 소개|가게만의 특별함)\s*:\s*/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.。!！?？]+$/u, "");
}

function squeezeText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
}

function splitBodyLines(value: string, maxCharsPerLine: number, maxLines: number) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
    }

    current = word;
  }

  if (current) {
    lines.push(current);
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const trimmed = lines.slice(0, maxLines);
  const lastIndex = trimmed.length - 1;
  trimmed[lastIndex] = `${trimmed[lastIndex].replace(/[.!\s]+$/g, "")}…`;
  return trimmed;
}

function buildCardCopy(
  card: FoodCardNewsPlanCard,
  submission: SubmissionForGeneration,
) {
  const menu = compactText(submission.target_menu_name, "대표 메뉴");
  const market = compactText(submission.stores?.market_name, "전통시장");
  const store = compactText(submission.stores?.store_name, "가게명");
  const price = compactText(submission.price_text, "가격 문의");
  const appeal = cleanInlineLabel(submission.appeal_point) ?? `${menu}의 매력`;
  const extra =
    cleanInlineLabel(submission.extra_message) ??
    "가게 분위기까지 함께 기억되는 한 끼";
  const caption =
    cleanInlineLabel(submission.caption) ??
    `${menu} 생각나는 날 다시 찾고 싶은 한 끼`;

  switch (card.key) {
    case "cover_vertical_still_life":
      return {
        title: squeezeText(menu, 12),
        subtitle: squeezeText(`${market} · ${store}`, 24),
        body: splitBodyLines(appeal, 18, 2),
        reason: "표지는 대표 메뉴가 가장 또렷하게 보이는 컷으로 고정",
      };
    case "dark_flatlay_editorial":
      return {
        title: squeezeText("대표 메뉴", 12),
        subtitle: squeezeText(extra, 24),
        body: splitBodyLines(`${market} ${store} ${price}`, 18, 2),
        reason: "정보성 속지는 메뉴 구성과 가격 흐름을 함께 전달",
      };
    case "circular_editorial_layout":
      return {
        title: squeezeText(menu, 12),
        subtitle: squeezeText("한 입 포인트", 24),
        body: splitBodyLines(appeal, 18, 2),
        reason: "클로즈업 카드에는 질감과 포인트 문구를 우선 배치",
      };
    case "vertical_quote_band":
      return {
        title: squeezeText("사장님 추천", 12),
        subtitle: squeezeText(`${store} · ${market}`, 24),
        body: splitBodyLines(extra, 18, 2),
        reason: "세로 띠 카드는 조리 장면과 추천 문장을 연결",
      };
    case "closing_information":
      return {
        title: squeezeText("오늘 눈여겨볼 메뉴", 12),
        subtitle: squeezeText(menu, 24),
        body: splitBodyLines(`${caption} ${price}`, 20, 2),
        reason: "마감 카드는 저장하고 싶은 요약 정보만 남김",
      };
  }
}

function chooseSlot(
  cardKey: FoodCardNewsPlanCard["key"],
  usedSlots: Set<FoodCardNewsSourceSlotKey>,
) {
  const priorities = CARD_SLOT_PRIORITY[cardKey];

  for (const slot of priorities) {
    if (!usedSlots.has(slot)) {
      usedSlots.add(slot);
      return slot;
    }
  }

  const fallback = priorities[0];
  usedSlots.add(fallback);
  return fallback;
}

function buildFallbackReviewedPlan(
  submission: SubmissionForGeneration,
  plan: FoodCardNewsCreativePlan,
): ReviewedFoodCardNewsPlan {
  const usedSlots = new Set<FoodCardNewsSourceSlotKey>();

  return {
    concept: plan.concept,
    tone: plan.tone,
    cards: plan.cards.map((card, index) => {
      const copy = buildCardCopy(card, submission);

      return {
        index,
        cardKey: card.key,
        title: copy.title,
        subtitle: copy.subtitle,
        body: copy.body,
        selectedSlot: chooseSlot(card.key, usedSlots),
        reason: copy.reason,
      };
    }),
  };
}

function stripCodeFence(value: string) {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function isReviewedCard(
  value: unknown,
): value is Omit<ReviewedFoodCardNewsCard, "index"> & { index?: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.cardKey === "string" &&
    typeof record.title === "string" &&
    typeof record.subtitle === "string" &&
    Array.isArray(record.body) &&
    typeof record.selectedSlot === "string" &&
    typeof record.reason === "string"
  );
}

function normalizeReviewedPlan(
  fallback: ReviewedFoodCardNewsPlan,
  candidate: unknown,
): ReviewedFoodCardNewsPlan {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return fallback;
  }

  const record = candidate as Record<string, unknown>;
  const cards = Array.isArray(record.cards) ? record.cards : null;

  if (!cards || cards.length !== fallback.cards.length) {
    return fallback;
  }

  const normalizedCards = cards.map((item, index) => {
    if (!isReviewedCard(item)) {
      return fallback.cards[index];
    }

    const fallbackCard = fallback.cards[index];
    const selectedSlot = item.selectedSlot as FoodCardNewsSourceSlotKey;

    const safeSlot = SOURCE_SLOT_KEYS.includes(selectedSlot)
      ? selectedSlot
      : fallbackCard.selectedSlot;

    const body = item.body
      .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
      .slice(0, 2)
      .map((line) => squeezeText(line, 20));

    return {
      index,
      cardKey: item.cardKey === fallbackCard.cardKey ? fallbackCard.cardKey : fallbackCard.cardKey,
      title: squeezeText(item.title, 12) || fallbackCard.title,
      subtitle: squeezeText(item.subtitle, 24) || fallbackCard.subtitle,
      body: body.length > 0 ? body : fallbackCard.body,
      selectedSlot: safeSlot,
      reason: item.reason.trim() || fallbackCard.reason,
    };
  });

  return {
    concept:
      typeof record.concept === "string" && record.concept.trim().length > 0
        ? record.concept.trim()
        : fallback.concept,
    tone:
      typeof record.tone === "string" && record.tone.trim().length > 0
        ? record.tone.trim()
        : fallback.tone,
    cards: normalizedCards,
  };
}

export async function reviewFoodCardNewsPlan(params: {
  submission: SubmissionForGeneration;
  plan: FoodCardNewsCreativePlan;
}): Promise<ReviewedFoodCardNewsPlan> {
  const fallback = buildFallbackReviewedPlan(params.submission, params.plan);
  const apiKey = getOpenAiApiKey();

  if (!apiKey) {
    return fallback;
  }

  const prompt = [
    "You are the second-pass reviewer for a Korean Instagram food card-news system.",
    "Your job is NOT to invent a new campaign. Your job is to refine a first-pass plan so it fits a fixed editorial template cleanly.",
    "Return strict JSON only with keys: concept, tone, cards.",
    "cards must be length 5 and preserve the original card order.",
    "Each card must contain: cardKey, title, subtitle, body, selectedSlot, reason.",
    "selectedSlot must be one of: menuBoard, coverPhoto, flatlayPhoto, detailPhoto, cookingPhoto, infoPhoto.",
    "Hard constraints:",
    "- title: 8 to 12 Korean characters max when possible.",
    "- subtitle: 18 to 24 Korean characters max when possible.",
    "- body: array of 1 or 2 short lines only.",
    "- Avoid repeated wording across cards.",
    "- Avoid assigning the same selectedSlot to every card unless absolutely necessary.",
    "- cover card should prefer coverPhoto or detailPhoto.",
    "- quote band should prefer cookingPhoto or detailPhoto.",
    "- closing card should prefer infoPhoto or menuBoard.",
    "- Keep the merchant's real selling point, but rewrite it into cleaner template-friendly Korean.",
    "- Remove awkward report-like phrases and reduce duplication.",
    "Submission facts:",
    JSON.stringify(
      {
        marketName: params.submission.stores?.market_name ?? null,
        storeName: params.submission.stores?.store_name ?? null,
        targetMenuName: params.submission.target_menu_name,
        priceText: params.submission.price_text ?? null,
        appealPoint: params.submission.appeal_point,
        extraMessage: params.submission.extra_message ?? null,
        caption: params.submission.caption ?? null,
      },
      null,
      2,
    ),
    "First pass plan:",
    JSON.stringify(params.plan, null, 2),
    "Fallback reviewed plan:",
    JSON.stringify(fallback, null, 2),
  ].join("\n");

  try {
    const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: prompt,
      }),
      timeoutMs: 30_000,
    });

    if (!response.ok) {
      return fallback;
    }

    const json = (await response.json()) as OpenAiResponsesResponse;
    const outputText =
      typeof json.output_text === "string" ? stripCodeFence(json.output_text) : "";

    if (!outputText) {
      return fallback;
    }

    return normalizeReviewedPlan(fallback, JSON.parse(outputText));
  } catch {
    return fallback;
  }
}
