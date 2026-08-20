import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVideoScript,
  buildWorkingCaptionMarkdown,
  normalizeAiWorkingCaptions,
} from "../lib/ai/video.ts";
import {
  getRequestedShot,
  buildPhotoRequest,
  buildSessionWorkflowSeed,
  inferPrimarySubjectFromIntro,
  normalizeAdSessionWorkflow,
} from "../lib/ad-session.ts";
import { buildDraftSubmissionFromSession } from "../lib/ad-session-preparation.ts";

test("buildSessionWorkflowSeed initializes draft preparation fields", () => {
  const workflow = buildSessionWorkflowSeed(
    "대표 메뉴는 제육볶음이고 직화 향이 강점입니다.",
  );

  assert.equal(workflow.currentShotIndex, 0);
  assert.equal(workflow.requestedShotKey, "menu_board");
  assert.equal(workflow.primarySubject, "제육볶음");
  assert.equal(workflow.draftCaption, null);
  assert.deepEqual(workflow.draftHashtags, []);
  assert.deepEqual(workflow.draftCarouselPrompts, []);
  assert.equal(workflow.draftFoodCardNewsPlan, null);
  assert.equal(workflow.draftPreparedAt, null);
  assert.equal(workflow.draftAssetCount, 0);
});

test("buildSessionWorkflowSeed initializes video shot plan when adType is video", () => {
  const workflow = buildSessionWorkflowSeed("대표 메뉴는 제육볶음입니다.", {
    adType: "video",
    menuIntro: "대표메뉴는 제육볶음 입니다.",
  });

  assert.equal(workflow.adType, "video");
  assert.equal(workflow.requestedShotKey, "video_storefront_sign");
  assert.equal(workflow.shotPlan?.length, 8);
});

test("normalizeAdSessionWorkflow preserves prepared draft fields", () => {
  const workflow = normalizeAdSessionWorkflow({
    currentShotIndex: 2,
    requestedShotKey: "flatlay_menu",
    primarySubject: "제육볶음",
    draftCaption: "말바우시장 골목에서 떠오르는 제육볶음 한 접시입니다.",
    draftHashtags: ["#말바우시장", "#제육볶음"],
    draftFoodCardNewsPlan: {
      concept: "시장형 카드뉴스",
    },
    draftCarouselPrompts: [
      {
        index: 0,
        key: "cover_vertical_still_life",
        prompt: "card 1 prompt",
      },
    ],
    draftPreparedAt: "2026-08-19T12:00:00.000Z",
    draftAssetCount: 3,
  });

  assert.equal(workflow.currentShotIndex, 2);
  assert.equal(workflow.requestedShotKey, "flatlay_menu");
  assert.equal(
    workflow.draftCaption,
    "말바우시장 골목에서 떠오르는 제육볶음 한 접시입니다.",
  );
  assert.deepEqual(workflow.draftHashtags, ["#말바우시장", "#제육볶음"]);
  assert.deepEqual(workflow.draftFoodCardNewsPlan, {
    concept: "시장형 카드뉴스",
  });
  assert.deepEqual(workflow.draftCarouselPrompts, [
    {
      index: 0,
      key: "cover_vertical_still_life",
      prompt: "card 1 prompt",
    },
  ]);
  assert.equal(workflow.draftPreparedAt, "2026-08-19T12:00:00.000Z");
  assert.equal(workflow.draftAssetCount, 3);
});

test("buildSessionWorkflowSeed prefers menuIntro over storeSpecialty for primary subject", () => {
  const workflow = buildSessionWorkflowSeed("combined intro", {
    menuIntro: "대표메뉴는 제육볶음 입니다.",
    storeSpecialty: "60년 전통의 맛집입니다.",
  });

  assert.equal(workflow.primarySubject, "제육볶음");
});

test("inferPrimarySubjectFromIntro ignores label text before extracting menu", () => {
  assert.equal(
    inferPrimarySubjectFromIntro("주력 메뉴를 포함한 대표 메뉴 소개: 대표메뉴는 제육볶음 입니다."),
    "제육볶음",
  );
});

test("buildPhotoRequest uses storefront, interior, and specialty-oriented prompts", () => {
  const storefront = buildPhotoRequest("restaurant_food", "flatlay_menu", {
    primarySubject: "제육볶음",
    storeSpecialty: "60년 전통의 맛집입니다.",
  });
  const interior = buildPhotoRequest("restaurant_food", "cooking_scene", {
    primarySubject: "제육볶음",
    storeSpecialty: "60년 전통의 맛집입니다.",
  });
  const specialty = buildPhotoRequest("restaurant_food", "detail_closeup", {
    primarySubject: "제육볶음",
    storeSpecialty: "60년 전통의 맛집입니다.",
  });

  assert.equal(storefront.prompt, "사진요청 : 가게 간판이 함께 보이도록 찍은 외관 사진");
  assert.equal(interior.prompt, "사진요청 : 가게 내부 분위기가 보이도록 찍은 사진");
  assert.equal(specialty.prompt, "사진요청 : 가게의 특별함이 드러나는 사진");
});

test("normalizeAdSessionWorkflow keeps video shot plan values", () => {
  const workflow = normalizeAdSessionWorkflow({
    adType: "video",
    currentShotIndex: 1,
    requestedShotKey: "video_storefront_entry",
    shotPlan: [
      "video_storefront_sign",
      "video_storefront_entry",
      "video_menu_board",
    ],
  });

  assert.equal(workflow.adType, "video");
  assert.equal(workflow.requestedShotKey, "video_storefront_entry");
  assert.deepEqual(workflow.shotPlan, [
    "video_storefront_sign",
    "video_storefront_entry",
    "video_menu_board",
  ]);
});

test("video prompts are returned as noun phrases for frontend sentence templates", () => {
  const workflow = buildSessionWorkflowSeed("대표 메뉴는 제육볶음입니다.", {
    adType: "video",
    menuIntro: "대표메뉴는 제육볶음 입니다.",
    storeSpecialty: "60년 전통의 맛집입니다.",
  });

  const firstPrompt = getRequestedShot(workflow, "restaurant_food");

  assert.equal(firstPrompt?.prompt, "가게 간판");

  const entryPrompt = getRequestedShot(
    {
      ...workflow,
      currentShotIndex: 1,
      requestedShotKey: "video_storefront_entry",
    },
    "restaurant_food",
  );

  assert.equal(entryPrompt?.prompt, "가게 입구에서 안으로 들어가는 모습");

  const menuPrompt = getRequestedShot(
    {
      ...workflow,
      currentShotIndex: 3,
      requestedShotKey: "video_signature_menu",
    },
    "restaurant_food",
  );

  assert.equal(menuPrompt?.prompt, "제육볶음");

  const cookingPrompt = getRequestedShot(
    {
      ...workflow,
      currentShotIndex: 5,
      requestedShotKey: "video_cooking_scene",
    },
    "restaurant_food",
  );

  assert.equal(cookingPrompt?.prompt, "제육볶음을 조리하는 모습");
});

test("buildDraftSubmissionFromSession keeps menu intro and store specialty separate", () => {
  const workflow = buildSessionWorkflowSeed("combined intro", {
    adType: "photo",
    menuIntro: "대표메뉴는 제육볶음 입니다. 불향이 강합니다.",
    storeSpecialty: "60년 전통의 손맛이 강점입니다.",
  });

  const submission = buildDraftSubmissionFromSession(
    {
      id: "session-1",
      intro_text:
        "주력 메뉴를 포함한 대표 메뉴 소개: 대표메뉴는 제육볶음 입니다.\n가게만의 특별함: 60년 전통의 손맛이 강점입니다.",
      style_preset: "food_card_news",
      workflow,
      stores: {
        market_name: "말바우시장",
        store_name: "득량만",
        owner_name: "홍길동",
        category: "restaurant_food",
        description: "시장 안 오래된 백반집",
        location_address: "광주 북구 동문대로",
      },
      ad_creation_session_assets: [],
    },
    workflow,
  );

  assert.equal(submission.appeal_point, "대표메뉴는 제육볶음 입니다. 불향이 강합니다.");
  assert.equal(submission.extra_message, "60년 전통의 손맛이 강점입니다.");
  assert.deepEqual(submission.ai_metadata?.merchantInsights, {
    targetCustomer: null,
    peakSalesTime: null,
    popularMenuNotes: "대표메뉴는 제육볶음 입니다. 불향이 강합니다.",
  });
});

test("buildVideoScript separates working captions from promotional caption", () => {
  const script = buildVideoScript(
    {
      storeName: "득량만",
      marketName: "말바우시장",
      storeType: "restaurant_food",
      targetMenuName: "제육볶음",
      priceText: null,
      appealPoint: "불향 가득한 직화 맛",
      extraMessage: "60년 전통의 손맛",
      targetCustomer: "든든한 한 끼를 찾는 손님",
      peakSalesTime: "점심시간",
      popularMenuNotes: "계란말이와 함께 찾는 손님이 많습니다",
    },
    "market_story",
  );

  assert.equal(script.workingCaptions.length, 8);
  assert.match(script.caption, /^제육볶음 어떠세요\? 불향 가득한 직화 맛 /);
  assert.match(script.workingCaptions[0]!, /말바우시장/);
  assert.match(script.workingCaptions[3]!, /제육볶음/);
});

test("buildWorkingCaptionMarkdown creates 8 cuts and 16 subtitle lines", () => {
  const markdown = buildWorkingCaptionMarkdown({
    hookText: "득량만 인기 메뉴",
    scenes: [
      { order: 1, text: "득량만 추천 메뉴", focus: "store_intro" },
      { order: 2, text: "불향 가득한 직화 맛", focus: "food_highlight" },
      { order: 3, text: "제육볶음", focus: "price_cta" },
    ],
    workingCaptions: [
      "첫 번째 문장입니다.",
      "두 번째 문장입니다.",
      "세 번째 문장입니다.",
      "네 번째 문장입니다.",
      "다섯 번째 문장입니다.",
      "여섯 번째 문장입니다.",
      "일곱 번째 문장입니다.",
      "여덟 번째 문장입니다.",
    ],
    caption: "광고용 캡션",
    hashtags: ["#말바우시장", "#득량만", "#제육볶음"],
  });

  assert.equal((markdown.match(/^## \[비디오 컷 /gm) ?? []).length, 8);
  assert.equal((markdown.match(/자막 \d+:\*\*/g) ?? []).length, 16);
  assert.match(markdown, /\[00:00 ~ 00:01\] 자막 1/);
  assert.match(markdown, /\[00:15 ~ 00:16\] 자막 16/);
});

test("buildWorkingCaptionMarkdown splits compact short captions without duplicating the same word", () => {
  const markdown = buildWorkingCaptionMarkdown({
    hookText: "득량만 인기 메뉴",
    scenes: [
      { order: 1, text: "득량만 추천 메뉴", focus: "store_intro" },
      { order: 2, text: "불향 가득한 직화 맛", focus: "food_highlight" },
      { order: 3, text: "제육볶음", focus: "price_cta" },
    ],
    workingCaptions: [
      "제육볶음",
      "두 번째 문장입니다.",
      "세 번째 문장입니다.",
      "네 번째 문장입니다.",
      "다섯 번째 문장입니다.",
      "여섯 번째 문장입니다.",
      "일곱 번째 문장입니다.",
      "여덟 번째 문장입니다.",
    ],
    caption: "광고용 캡션",
    hashtags: ["#말바우시장", "#득량만", "#제육볶음"],
  });

  assert.match(markdown, /자막 1:\*\* 제육/);
  assert.match(markdown, /자막 2:\*\* 볶음/);
  assert.doesNotMatch(markdown, /자막 1:\*\* 제육볶음[\s\S]*자막 2:\*\* 제육볶음/);
});

test("normalizeAiWorkingCaptions keeps valid 8-line AI captions", () => {
  const fallback = [
    "기본 자막 하나",
    "기본 자막 둘",
    "기본 자막 셋",
    "기본 자막 넷",
    "기본 자막 다섯",
    "기본 자막 여섯",
    "기본 자막 일곱",
    "기본 자막 여덟",
  ];

  const normalized = normalizeAiWorkingCaptions(
    {
      workingCaptions: [
        "시장 안에서 먼저 눈에 들어와요",
        "가게 분위기부터 편하게 다가오고",
        "제육볶음 향이 금방 식욕을 깨우고",
        "불향이 입안 가득 살아납니다",
        "든든한 한 끼 찾을 때 딱 좋고",
        "점심시간에 더 자주 생각나고",
        "곁들이는 반찬까지 손이 가고",
        "오늘 한 끼로 기억되기 충분해요",
      ],
    },
    fallback,
  );

  assert.deepEqual(normalized, [
    "시장 안에서 먼저 눈에 들어와요",
    "가게 분위기부터 편하게 다가오고",
    "제육볶음 향이 금방 식욕을 깨우고",
    "불향이 입안 가득 살아납니다",
    "든든한 한 끼 찾을 때 딱 좋고",
    "점심시간에 더 자주 생각나고",
    "곁들이는 반찬까지 손이 가고",
    "오늘 한 끼로 기억되기 충분해요",
  ]);
});

test("normalizeAiWorkingCaptions falls back when AI captions are duplicated or invalid", () => {
  const fallback = [
    "기본 자막 하나",
    "기본 자막 둘",
    "기본 자막 셋",
    "기본 자막 넷",
    "기본 자막 다섯",
    "기본 자막 여섯",
    "기본 자막 일곱",
    "기본 자막 여덟",
  ];

  const normalized = normalizeAiWorkingCaptions(
    {
      workingCaptions: Array.from({ length: 8 }, () => "제육볶음"),
    },
    fallback,
  );

  assert.deepEqual(normalized, fallback);
});
