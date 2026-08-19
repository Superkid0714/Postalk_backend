import assert from "node:assert/strict";
import test from "node:test";

import { buildCaptionInputContext } from "../lib/ai/context.ts";
import {
  clearTourismCorpusCache,
  getTourismCorpusContext,
} from "../lib/public-data/tourism-corpus.ts";
import type { SubmissionForGeneration } from "../lib/ai/generation.ts";

function buildSubmission(): SubmissionForGeneration {
  return {
    id: "submission-tourism-1",
    title: null,
    caption: null,
    store_type: "분식집",
    target_menu_name: "떡볶이",
    price_text: "4,500원",
    appeal_point: "시장 골목에서 가볍게 포장해 가기 좋음",
    extra_message: "매콤달콤한 양념이 강점",
    ai_metadata: {
      merchantInsights: {
        targetCustomer: "학생과 직장인",
        peakSalesTime: "오후 간식 시간",
        popularMenuNotes: "포장 수요가 많음",
      },
    },
    stores: {
      market_name: "말바우시장",
      store_name: "행운분식",
      owner_name: null,
      latitude: 35.1735,
      longitude: 126.911,
    },
  };
}

test.afterEach(() => {
  clearTourismCorpusCache();
});

test("getTourismCorpusContext selects style examples for Gwangju/Jeolla inputs", async () => {
  const markdown = `
1. [문화관광] 광주호호수생태원
> 관광지명 광주호호수생태원 개요 광주의 여유로운 풍경과 산책 흐름을 자연스럽게 즐기기 좋은 공간입니다. 주소(AD) 광주광역시 북구

2. [문화관광] 전주한옥마을
> 관광지명 전주한옥마을 개요 전주의 골목을 천천히 걸으며 따뜻한 분위기를 느끼기 좋은 장소입니다. 주소(AD) 전라북도 전주시
`;

  const context = await getTourismCorpusContext(
    {
      marketName: "말바우시장",
      province: "광주광역시",
      district: "북구",
      product: "떡볶이",
      appealPoint: "시장 골목 포장",
      extraMessage: "매콤달콤",
    },
    {
      reportPath: "virtual-tourism-report.md",
      fileReader: async () => markdown,
      maxItems: 2,
    },
  );

  assert.equal(context.found, true);
  assert.equal(context.selected_for_prompt, true);
  assert.equal(context.verified, true);
  assert.ok(context.examples.length >= 1);
  assert.equal(context.examples[0]?.place_name, "광주호호수생태원");
});

test("getTourismCorpusContext skips non-Gwangju/Jeolla inputs", async () => {
  const context = await getTourismCorpusContext(
    {
      marketName: "망원시장",
      province: "서울특별시",
      district: "마포구",
      product: "떡볶이",
      appealPoint: "포장 가능",
      extraMessage: null,
    },
    {
      reportPath: "unused.md",
      fileReader: async () => "",
    },
  );

  assert.equal(context.found, false);
  assert.equal(context.selected_for_prompt, false);
  assert.match(context.selection_reason ?? "", /광주·전라권/u);
});

test("buildCaptionInputContext includes tourism corpus context when provided", async () => {
  const submission = buildSubmission();

  const context = await buildCaptionInputContext(submission, {
    marketContextLoader: async () => ({
      found: true,
      status: "found",
      source: "소상공인시장진흥공단_전통시장현황",
      market_code: "a62040004",
      market_name: "말바우시장",
      market_type: "전통시장",
      province: "광주광역시",
      district: "북구",
      road_address: "광주광역시 북구 동문대로97번길 55",
      latitude: 35.1735,
      longitude: 126.911,
      facilities: {
        arcade: true,
        parking: true,
        rest_area: false,
        luggage_storage: false,
        foreigner_information_center: false,
      },
      error: null,
    }),
    weatherContextLoader: async () => ({
      found: false,
      status: "not_found",
      source: "기상청_VilageFcstInfoService_2.0",
      latitude: null,
      longitude: null,
      nx: null,
      ny: null,
      current: null,
      forecast: null,
      weather_focus: "neutral",
      summary: null,
      verified: false,
      selected_for_prompt: false,
      selection_reason: "날씨 문맥 미사용",
      error: null,
    }),
    festivalContextLoader: async () => ({
      found: false,
      source: "한국관광공사_국문 관광정보 서비스_GW",
      content_id: null,
      title: null,
      event_start_date: null,
      event_end_date: null,
      address: null,
      latitude: null,
      longitude: null,
      distance_km: null,
      region_match: false,
      verified: false,
      reason: "no_relevant_festival",
    }),
    kamisContextLoader: async () => ({
      used: false,
      source: "한국농수산식품유통공사_지역별 품목별 도소매 가격정보",
      matched: false,
      merchant_product: "떡볶이",
      matched_item: null,
      matched_item_code: null,
      region: null,
      region_code: null,
      price_type: null,
      period_start: null,
      period_end: null,
      unit: null,
      unit_size: null,
      grade: null,
      variety: null,
      latest_price: null,
      average_price: null,
      latest_price_date: null,
      price_trend: null,
      unit_match: false,
      region_match: false,
      price_comparison_allowed: false,
      verified: false,
      selected_for_prompt: false,
      selection_reason: "사용자 상품이 KAMIS 지원 품목이 아니어서 조회하지 않음",
      reason: "product_not_supported",
    }),
    tourismCorpusContextLoader: async () => ({
      found: true,
      source: "광주전라 관광 말뭉치 RAG 보고서",
      verified: true,
      selected_for_prompt: true,
      selection_reason: "광주·전라권 관광 홍보 말뭉치에서 문체 참고 예시를 추출함",
      report_path: "virtual-tourism-report.md",
      region_scope: "광주광역시",
      examples: [
        {
          place_name: "광주호호수생태원",
          category: "문화관광",
          excerpt: "광주의 여유로운 풍경과 산책 흐름을 자연스럽게 즐기기 좋은 공간입니다.",
          overlap_keywords: ["광주"],
          score: 5,
        },
      ],
      error: null,
    }),
  });

  assert.equal(context.tourism_corpus_context.selected_for_prompt, true);
  assert.equal(context.selected_context.tourism_corpus, true);
  assert.equal(
    context.selection_reason.tourism_corpus,
    "광주·전라권 관광 홍보 말뭉치에서 문체 참고 예시를 추출함",
  );
});
