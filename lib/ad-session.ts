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
  const normalized = introText.replace(/\s+/g, " ").trim();
  const preferredMatches = normalized.match(
    /([가-힣A-Za-z0-9]{2,20}(?:찌개|볶음|국밥|칼국수|수육|비빔밥|통닭|치킨|만두|전|튀김|국수|탕|라떼|커피|빵|케이크))/u,
  );

  if (preferredMatches?.[1]) {
    return preferredMatches[1];
  }

  const tokenMatches = normalized.match(/[가-힣A-Za-z0-9]{2,20}/gu) ?? [];

  return tokenMatches[0] ?? "대표 메뉴";
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
    primarySubject: inferPrimarySubjectFromIntro(introText),
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

  return buildPhotoRequest(category, shotKey, workflow.primarySubject ?? "대표 메뉴");
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
    request: buildPhotoRequest(category, shotKey, workflow.primarySubject ?? "대표 메뉴"),
  };
}

function findGuideOrderByTitle(category: StoreCategoryCode, titles: string[]) {
  const guide = getPhotoGuideByCategory(category);
  const allShots = [...guide.commonShots, ...guide.categoryShots];
  const matched = allShots.find((shot) => titles.includes(shot.title));

  return matched?.order ?? null;
}

export function buildPhotoRequest(
  category: StoreCategoryCode,
  shotKey: AdSessionShotKey,
  primarySubject: string,
): AdSessionPhotoRequest {
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
      prompt: `사진요청 : ${primarySubject}`,
      helperText: `${primarySubject} 완성 메뉴를 정면 또는 45도 각도에서 선명하게 찍어주세요.`,
      reviewShotOrder: findGuideOrderByTitle(category, ["전체 밥상", "완성 메뉴", "대표 상품"]),
    };
  }

  if (shotKey === "flatlay_menu") {
    return {
      shotKey,
      assetType: "food_photo",
      title: `${primarySubject} 탑다운`,
      prompt: `사진요청 : ${primarySubject} 탑다운`,
      helperText:
        "대표 메뉴와 곁들임이 함께 보이도록 위에서 내려다본 구도로 찍어주세요. 여백이 조금 남으면 더 좋습니다.",
      reviewShotOrder: findGuideOrderByTitle(category, ["전체 밥상", "완성 메뉴", "매대 전체"]),
    };
  }

  if (shotKey === "cooking_scene") {
    return {
      shotKey,
      assetType: "food_photo",
      title: "조리 장면",
      prompt: "사진요청 : 조리 장면",
      helperText:
        "사장님이 직접 만들거나 손질하는 핵심 순간을 자연스럽게 찍어주세요.",
      reviewShotOrder: findGuideOrderByTitle(category, ["사장님이 요리하는 모습", "제작 과정", "손질 장면", "작업 중 장면"]),
    };
  }

  return {
    shotKey,
    assetType: "food_photo",
    title: `${primarySubject} 클로즈업`,
    prompt: `사진요청 : ${primarySubject} 클로즈업`,
    helperText:
      "한 입 포인트가 느껴지도록 가까이서 찍어주세요. 재료 결이나 식감이 보이면 좋습니다.",
    reviewShotOrder: findGuideOrderByTitle(category, ["건더기 들어 올리기", "한 입 포인트", "디테일 액션", "대표 추천 메뉴"]),
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
    primarySubject: workflow.primarySubject ?? "대표 메뉴",
  };
}
