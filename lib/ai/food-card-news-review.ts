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

function optionalText(value: string | null | undefined) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
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

function stripReportTone(value: string) {
  return value
    .replace(/(주력 메뉴를 포함한 대표 메뉴 소개|가게만의 특별함|대표 메뉴|특별함)\s*[:：]?\s*/gu, "")
    .replace(/(입니다|합니다)(\s*[.。!！?？])?$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function squeezeText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
}

function buildPunchyPhrase(
  value: string | null | undefined,
  fallback: string,
  maxLength: number,
) {
  const cleaned = stripReportTone(cleanInlineLabel(value) ?? fallback);
  return squeezeText(cleaned || fallback, maxLength);
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

function joinCopyParts(...parts: Array<string | null | undefined>) {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");
}

function buildCardCopy(
  card: FoodCardNewsPlanCard,
  submission: SubmissionForGeneration,
) {
  const menu = compactText(submission.target_menu_name, "대표 메뉴");
  const market = compactText(submission.stores?.market_name, "전통시장");
  const store = compactText(submission.stores?.store_name, "가게명");
  const price = optionalText(submission.price_text);
  const appeal = buildPunchyPhrase(submission.appeal_point, `${menu}의 매력`, 28);
  const extra =
    buildPunchyPhrase(
      submission.extra_message,
      "가게 분위기까지 함께 기억되는 한 끼",
      28,
    ) ??
    "가게 분위기까지 함께 기억되는 한 끼";
  const caption =
    buildPunchyPhrase(
      submission.caption,
      `${menu} 생각나는 날 다시 찾고 싶은 한 끼`,
      34,
    ) ??
    `${menu} 생각나는 날 다시 찾고 싶은 한 끼`;
  const marketStore = squeezeText(`${market} ${store}`, 18);
  const premiumCue = squeezeText(`${menu} 한 입의 인상`, 12);

  switch (card.key) {
    case "cover_vertical_still_life":
      return {
        title: squeezeText(menu, 10),
        subtitle: squeezeText(`${market}의 오늘 한 접시`, 18),
        body: splitBodyLines(
          joinCopyParts(appeal, price ? `지금 ${price}` : "지금 가장 생각나는 한 접시"),
          16,
          2,
        ),
        reason: "표지는 시그니처 메뉴를 한 번에 각인시키는 히어로 컷이 가장 적합",
      };
    case "dark_flatlay_editorial":
      return {
        title: squeezeText("오늘의 포인트", 10),
        subtitle: squeezeText(appeal, 20),
        body: splitBodyLines(
          joinCopyParts(marketStore, price ? `가볍게 ${price}` : "기억에 남는 시장 한 끼"),
          16,
          2,
        ),
        reason: "플랫레이 카드는 판매 포인트와 분위기 정보를 가장 단정하게 정리하기 좋음",
      };
    case "circular_editorial_layout":
      return {
        title: squeezeText(premiumCue, 10),
        subtitle: squeezeText(extra, 20),
        body: splitBodyLines(`${menu} ${appeal}`, 16, 2),
        reason: "클로즈업 카드에는 질감과 여운이 남는 짧은 카피가 가장 잘 어울림",
      };
    case "vertical_quote_band":
      return {
        title: squeezeText("지금 추천", 10),
        subtitle: squeezeText(`${store}에서 고른 한 컷`, 20),
        body: splitBodyLines(joinCopyParts(appeal, extra), 16, 2),
        reason: "세로 띠 카드는 조리 장면과 감성 카피를 묶어 인상을 남기기 좋음",
      };
    case "closing_information":
      return {
        title: squeezeText("저장해둘 한 끼", 10),
        subtitle: squeezeText(menu, 16),
        body: splitBodyLines(joinCopyParts(caption, marketStore), 18, 2),
        reason: "마감 카드는 다시 떠오를 한 줄과 가게 정보를 깔끔하게 남기는 데 집중",
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
    `cards must be length ${fallback.cards.length} and preserve the original card order.`,
    "Each card must contain: cardKey, title, subtitle, body, selectedSlot, reason.",
    "selectedSlot must be one of: menuBoard, coverPhoto, flatlayPhoto, detailPhoto, cookingPhoto, infoPhoto.",
    "Hard constraints:",
    "- title: 8 to 12 Korean characters max when possible.",
    "- subtitle: 18 to 24 Korean characters max when possible.",
    "- body: array of 1 or 2 short lines only.",
    "- Text must feel premium, sensory, and promotional. Avoid generic report tone.",
    "- Prefer concrete appetite-triggering wording over abstract descriptions.",
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
