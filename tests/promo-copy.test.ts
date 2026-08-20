import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicDataFlavorText,
  normalizePromoCaptionOutput,
} from "../lib/ai/generation.ts";
import { buildFoodCardNewsPublicDataCue } from "../lib/ai/food-card-news-review.ts";

test("buildPublicDataFlavorText prefers verified festival context", () => {
  const result = buildPublicDataFlavorText({
    festivalContext: {
      found: true,
      verified: true,
      title: "광주 문화축제",
    } as never,
    weatherContext: {
      selected_for_prompt: true,
      summary: "비 오는 날 따끈하게 즐기기 좋음",
    } as never,
  });

  assert.equal(result, "광주 문화축제 무렵 들르기 좋은 분위기까지 함께 전해집니다.");
});

test("buildFoodCardNewsPublicDataCue creates a short grounded cue", () => {
  const result = buildFoodCardNewsPublicDataCue({
    marketLabel: "말바우시장 광주 북구",
  });

  assert.equal(result, "말바우시장 광주 북구에서 기억될 메뉴");
});

test("normalizePromoCaptionOutput trims valid caption output and hashtags", () => {
  const result = normalizePromoCaptionOutput(
    {
      caption:
        "주력 메뉴를 포함한 대표 메뉴 소개: 불향이 살아 있어서 한입부터 당깁니다. 점심시간에 더 반가운 메뉴라 부담 없이 찾기 좋습니다. 오늘 한 끼 생각날 때 편하게 들러보세요.",
      hashtags: ["말바우시장", "#제육볶음", " 점심추천 "],
    },
    {
      caption: "fallback caption",
      hashtags: ["#fallback1", "#fallback2", "#fallback3"],
    },
  );

  assert.equal(
    result.caption,
    "불향이 살아 있어서 한입부터 당깁니다. 점심시간에 더 반가운 메뉴라 부담 없이 찾기 좋습니다. 오늘 한 끼 생각날 때 편하게 들러보세요.",
  );
  assert.deepEqual(result.hashtags, ["#말바우시장", "#제육볶음", "#점심추천"]);
});

test("normalizePromoCaptionOutput falls back for too-short captions", () => {
  const fallback = {
    caption: "기본 캡션입니다. 자연스럽게 다시 찾고 싶은 한 끼로 소개합니다.",
    hashtags: ["#말바우시장", "#득량만", "#제육볶음"],
  };

  const result = normalizePromoCaptionOutput(
    {
      caption: "짧음",
      hashtags: ["#a", "#b", "#c"],
    },
    fallback,
  );

  assert.deepEqual(result, fallback);
});
