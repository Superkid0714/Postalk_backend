import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSessionWorkflowSeed,
  normalizeAdSessionWorkflow,
} from "../lib/ad-session.ts";

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
