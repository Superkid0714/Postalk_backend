import { getPhotoGuideByCategory } from "@/lib/photo-guides";
import {
  getStoreCategoryLabel,
  isStoreCategoryCode,
  type StoreCategoryCode,
} from "@/lib/store-categories";

export type AdSessionStatus =
  | "collecting"
  | "ready_for_generation"
  | "generating"
  | "completed"
  | "failed";

export type AdSessionShotKey =
  | "menu_board"
  | "signature_menu"
  | "flatlay_menu"
  | "cooking_scene"
  | "detail_closeup";

export type AdSessionWorkflow = {
  currentShotIndex?: number;
  requestedShotKey?: AdSessionShotKey | null;
  primarySubject?: string | null;
  menuIntro?: string | null;
  storeSpecialty?: string | null;
  shotPlan?: AdSessionShotKey[];
  caption?: string | null;
  hashtags?: string[];
  draftCaption?: string | null;
  draftHashtags?: string[];
  draftFoodCardNewsPlan?: Record<string, unknown> | null;
  draftCarouselPrompts?: Array<{
    index: number;
    key: string;
    prompt: string;
  }>;
  draftPreparedAt?: string | null;
  draftAssetCount?: number;
  lastFailureReason?: string | null;
};

export type AdSessionStore = {
  id: string;
  market_name: string;
  store_name: string;
  owner_name: string | null;
  category: string | null;
  location_address?: string | null;
  description?: string | null;
};

export type AdSessionPhotoRequest = {
  shotKey: AdSessionShotKey;
  assetType: "menu_board" | "food_photo";
  title: string;
  prompt: string;
  helperText: string;
  reviewShotOrder: number | null;
};

const DEFAULT_FOOD_SHOT_PLAN: AdSessionShotKey[] = [
  "menu_board",
  "signature_menu",
  "flatlay_menu",
  "cooking_scene",
  "detail_closeup",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getDefaultSessionCategory(category: string | null | undefined) {
  if (isStoreCategoryCode(category)) {
    return category;
  }

  return "restaurant_food" as StoreCategoryCode;
}

export function inferPrimarySubjectFromIntro(introText: string) {
  const normalized = introText
    .replace(/주력 메뉴를 포함한 대표 메뉴 소개\s*:\s*/g, "")
    .replace(/가게만의 특별함\s*:\s*/g, "")
    .replace(/대표\s*메뉴(?:는|가)?\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const preferredMatches = normalized.match(
    /([가-힣A-Za-z0-9]{2,20}(?:찌개|볶음|국밥|칼국수|수육|비빔밥|통닭|치킨|만두|전|튀김|국수|탕|라떼|커피|빵|케이크))/u,
  );

  if (preferredMatches?.[1]) {
    return preferredMatches[1];
  }

  const tokenMatches = normalized.match(/[가-힣A-Za-z0-9]{2,20}/gu) ?? [];

  return tokenMatches[0] ?? "주력 메뉴";
}

function inferPrimarySubject(options: {
  introText: string;
  menuIntro?: string | null;
  storeSpecialty?: string | null;
}) {
  const prioritizedSources = [
    options.menuIntro?.trim() || null,
    options.storeSpecialty?.trim() || null,
    options.introText.trim(),
  ];

  for (const source of prioritizedSources) {
    if (!source) {
      continue;
    }

    const inferred = inferPrimarySubjectFromIntro(source);

    if (inferred.trim().length > 0 && inferred !== "주력 메뉴") {
      return inferred;
    }
  }

  return inferPrimarySubjectFromIntro(options.introText);
}

export function normalizeAdSessionWorkflow(value: unknown): AdSessionWorkflow {
  if (!isObject(value)) {
    return {};
  }

  return {
    currentShotIndex:
      typeof value.currentShotIndex === "number" ? value.currentShotIndex : 0,
    requestedShotKey:
      value.requestedShotKey === "menu_board" ||
      value.requestedShotKey === "signature_menu" ||
      value.requestedShotKey === "flatlay_menu" ||
      value.requestedShotKey === "cooking_scene" ||
      value.requestedShotKey === "detail_closeup"
        ? value.requestedShotKey
        : null,
    primarySubject:
      typeof value.primarySubject === "string" ? value.primarySubject : null,
    menuIntro: typeof value.menuIntro === "string" ? value.menuIntro : null,
    storeSpecialty:
      typeof value.storeSpecialty === "string" ? value.storeSpecialty : null,
    shotPlan: Array.isArray(value.shotPlan)
      ? value.shotPlan.filter(
          (item): item is AdSessionShotKey =>
            item === "menu_board" ||
            item === "signature_menu" ||
            item === "flatlay_menu" ||
            item === "cooking_scene" ||
            item === "detail_closeup",
        )
      : DEFAULT_FOOD_SHOT_PLAN,
    caption: typeof value.caption === "string" ? value.caption : null,
    hashtags: Array.isArray(value.hashtags)
      ? value.hashtags.filter((item): item is string => typeof item === "string")
      : [],
    draftCaption:
      typeof value.draftCaption === "string" ? value.draftCaption : null,
    draftHashtags: Array.isArray(value.draftHashtags)
      ? value.draftHashtags.filter((item): item is string => typeof item === "string")
      : [],
    draftFoodCardNewsPlan:
      isObject(value.draftFoodCardNewsPlan) ? value.draftFoodCardNewsPlan : null,
    draftCarouselPrompts: Array.isArray(value.draftCarouselPrompts)
      ? value.draftCarouselPrompts
          .filter(
            (
              item,
            ): item is {
              index: number;
              key: string;
              prompt: string;
            } =>
              isObject(item) &&
              typeof item.index === "number" &&
              typeof item.key === "string" &&
              typeof item.prompt === "string",
          )
      : [],
    draftPreparedAt:
      typeof value.draftPreparedAt === "string" ? value.draftPreparedAt : null,
    draftAssetCount:
      typeof value.draftAssetCount === "number" ? value.draftAssetCount : 0,
    lastFailureReason:
      typeof value.lastFailureReason === "string" ? value.lastFailureReason : null,
  };
}

export function buildSessionWorkflowSeed(
  introText: string,
  options?: {
    menuIntro?: string | null;
    storeSpecialty?: string | null;
  },
): AdSessionWorkflow {
  return {
    currentShotIndex: 0,
    requestedShotKey: DEFAULT_FOOD_SHOT_PLAN[0],
    primarySubject: inferPrimarySubject({
      introText,
      menuIntro: options?.menuIntro ?? null,
      storeSpecialty: options?.storeSpecialty ?? null,
    }),
    menuIntro: options?.menuIntro ?? null,
    storeSpecialty: options?.storeSpecialty ?? null,
    shotPlan: DEFAULT_FOOD_SHOT_PLAN,
    caption: null,
    hashtags: [],
    draftCaption: null,
    draftHashtags: [],
    draftFoodCardNewsPlan: null,
    draftCarouselPrompts: [],
    draftPreparedAt: null,
    draftAssetCount: 0,
    lastFailureReason: null,
  };
}

export function getRequestedShot(
  workflow: AdSessionWorkflow,
  category: StoreCategoryCode,
) {
  const shotPlan = workflow.shotPlan?.length ? workflow.shotPlan : DEFAULT_FOOD_SHOT_PLAN;
  const currentShotIndex =
    typeof workflow.currentShotIndex === "number" ? workflow.currentShotIndex : 0;
  const shotKey = shotPlan[currentShotIndex] ?? null;

  if (!shotKey) {
    return null;
  }

  return buildPhotoRequest(category, shotKey, {
    primarySubject: workflow.primarySubject ?? "주력 메뉴",
    storeSpecialty: workflow.storeSpecialty ?? null,
  });
}

export function getNextShot(
  workflow: AdSessionWorkflow,
  category: StoreCategoryCode,
) {
  const shotPlan = workflow.shotPlan?.length ? workflow.shotPlan : DEFAULT_FOOD_SHOT_PLAN;
  const nextIndex =
    (typeof workflow.currentShotIndex === "number" ? workflow.currentShotIndex : 0) + 1;
  const shotKey = shotPlan[nextIndex] ?? null;

  if (!shotKey) {
    return null;
  }

  return {
    nextIndex,
    request: buildPhotoRequest(category, shotKey, {
      primarySubject: workflow.primarySubject ?? "주력 메뉴",
      storeSpecialty: workflow.storeSpecialty ?? null,
    }),
  };
}

function findGuideOrderByTitle(category: StoreCategoryCode, titles: string[]) {
  const guide = getPhotoGuideByCategory(category);
  const allShots = [...guide.commonShots, ...guide.categoryShots];
  const matched = allShots.find((shot) => titles.includes(shot.title));

  return matched?.order ?? null;
}

function toObjectParticle(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "메뉴를";
  }

  const lastChar = trimmed[trimmed.length - 1];
  const code = lastChar.charCodeAt(0);
  const isHangulSyllable = code >= 0xac00 && code <= 0xd7a3;

  if (!isHangulSyllable) {
    return `${trimmed}를`;
  }

  const hasFinalConsonant = (code - 0xac00) % 28 !== 0;

  return `${trimmed}${hasFinalConsonant ? "을" : "를"}`;
}

function normalizeSpecialtyPrompt(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/^가게만의 특별함\s*:\s*/u, "").replace(/\s+/g, " ").trim();
}

export function buildPhotoRequest(
  category: StoreCategoryCode,
  shotKey: AdSessionShotKey,
  options: {
    primarySubject: string;
    storeSpecialty?: string | null;
  },
): AdSessionPhotoRequest {
  const primarySubject = options.primarySubject;
  const specialtyPrompt = normalizeSpecialtyPrompt(options.storeSpecialty ?? null);

  if (shotKey === "menu_board") {
    return {
      shotKey,
      assetType: "menu_board",
      title: "메뉴판",
      prompt: "사진요청 : 메뉴판",
      helperText: "대표 메뉴와 가격이 또렷하게 보이도록 메뉴판을 찍어주세요.",
      reviewShotOrder: findGuideOrderByTitle(category, ["메뉴판", "메뉴판 또는 품목표"]),
    };
  }

  if (shotKey === "signature_menu") {
    return {
      shotKey,
      assetType: "food_photo",
      title: primarySubject,
      prompt: `사진요청 : ${toObjectParticle(primarySubject)} 정면 또는 45도 각도에서 찍은 사진`,
      helperText: `${primarySubject} 완성 메뉴를 정면 또는 45도 각도에서 선명하게 찍어주세요.`,
      reviewShotOrder: findGuideOrderByTitle(category, ["전체 밥상", "완성 메뉴", "대표 상품"]),
    };
  }

  if (shotKey === "flatlay_menu") {
    return {
      shotKey,
      assetType: "food_photo",
      title: "가게 외관",
      prompt: "사진요청 : 가게 간판이 함께 보이도록 찍은 외관 사진",
      helperText:
        "가게 이름이나 간판이 잘 보이도록 가게 앞모습을 찍어주세요. 입구 분위기도 함께 보이면 좋습니다.",
      reviewShotOrder: null,
    };
  }

  if (shotKey === "cooking_scene") {
    return {
      shotKey,
      assetType: "food_photo",
      title: "가게 내부",
      prompt: "사진요청 : 가게 내부 분위기가 보이도록 찍은 사진",
      helperText:
        "좌석, 진열, 조리 공간 등 가게 분위기가 자연스럽게 드러나도록 내부 사진을 찍어주세요.",
      reviewShotOrder: null,
    };
  }

  return {
    shotKey,
    assetType: "food_photo",
    title: specialtyPrompt ? "가게의 특별함" : `${primarySubject} 클로즈업`,
    prompt: specialtyPrompt
      ? "사진요청 : 가게의 특별함이 드러나는 사진"
      : `사진요청 : ${toObjectParticle(primarySubject)} 가까이서 찍은 클로즈업 사진`,
    helperText:
      specialtyPrompt
        ? `사장님이 말한 특별함이 드러나는 장면을 찍어주세요. 예: ${specialtyPrompt}`
        : "한 입 포인트가 느껴지도록 가까이서 찍어주세요. 재료 결이나 식감이 보이면 좋습니다.",
    reviewShotOrder: specialtyPrompt
      ? null
      : findGuideOrderByTitle(category, ["건더기 들어 올리기", "한 입 포인트", "디테일 액션", "대표 추천 메뉴"]),
  };
}

export function buildSessionStoreType(store: AdSessionStore) {
  return getStoreCategoryLabel(store.category) ?? store.category ?? "전통시장 점포";
}

export function buildSessionSummary(store: AdSessionStore, workflow: AdSessionWorkflow) {
  return {
    marketName: store.market_name,
    storeName: store.store_name,
    ownerName: store.owner_name,
    category: store.category,
    categoryLabel: getStoreCategoryLabel(store.category),
    locationAddress: store.location_address ?? store.description ?? null,
    primarySubject: workflow.primarySubject ?? "주력 메뉴",
  };
}
