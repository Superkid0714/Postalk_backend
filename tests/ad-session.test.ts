import assert from "node:assert/strict";
import test from "node:test";

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
