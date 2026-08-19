import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCaptionInputContext,
  buildMerchantContext,
} from "../lib/ai/context.ts";
import {
  clearTraditionalMarketCache,
  getMarketContext,
  normalizeMarketName,
} from "../lib/public-data/traditional-market.ts";
import type { SubmissionForGeneration } from "../lib/ai/generation.ts";

function createJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function buildSubmission(): SubmissionForGeneration {
  return {
    id: "submission-1",
    title: null,
    caption: null,
    store_type: "분식집",
    target_menu_name: "떡볶이",
    price_text: "4,000원",
    appeal_point: "포장 가능",
    extra_message: "매일 아침 직접 조리",
    ai_metadata: {
      merchantInsights: {
        targetCustomer: "학생과 직장인",
        peakSalesTime: "오후 간식 시간",
        popularMenuNotes: "매콤달콤한 메뉴를 많이 찾음",
      },
    },
    stores: {
      market_name: "말바우 시장",
      store_name: "행운분식",
      owner_name: null,
    },
  };
}

test.afterEach(() => {
  clearTraditionalMarketCache();
});

test("normalizeMarketName handles spaces and suffix differences", () => {
  assert.equal(normalizeMarketName(" 말바우시장 "), "말바우");
  assert.equal(normalizeMarketName("말바우 시장"), "말바우");
  assert.equal(normalizeMarketName("말바우전통시장"), "말바우");
});

test("getMarketContext finds a market across paginated responses", async () => {
  const pages = [
    createJsonResponse(200, {
      data: [
        {
          시장명: "다른시장",
        },
      ],
      currentCount: 100,
      page: 1,
      perPage: 100,
      totalCount: 101,
    }),
    createJsonResponse(200, {
      data: [
        {
          시장코드: "a62040004",
          시장명: "말바우시장",
          시장유형: "전통시장",
          도로명주소: "광주 북구 동문대로 97번길 81",
          시도: "광주광역시",
          시군구: "북구",
          아케이드보유여부: "Y",
          "시장전용 고객주차장_보유여부": "Y",
          고객휴게실_보유여부: "N",
          물품보관함_보유여부: "N",
          "외국인 안내센터_보유여부": "N",
        },
      ],
      currentCount: 1,
      page: 2,
      perPage: 100,
      totalCount: 101,
    }),
  ];

  const marketContext = await getMarketContext("말바우 시장", {
    serviceKey: "test-key",
    fetchImpl: async () => pages.shift() ?? createJsonResponse(200, { data: [] }),
  });

  assert.equal(marketContext.found, true);
  assert.equal(marketContext.status, "found");
  assert.equal(marketContext.market_code, "a62040004");
  assert.equal(marketContext.market_name, "말바우시장");
  assert.equal(marketContext.province, "광주광역시");
  assert.equal(marketContext.district, "북구");
  assert.equal(marketContext.facilities.arcade, true);
  assert.equal(marketContext.facilities.parking, true);
  assert.equal(marketContext.facilities.rest_area, false);
});

test("getMarketContext returns not_found for an unknown market", async () => {
  const marketContext = await getMarketContext("없는시장", {
    serviceKey: "test-key",
    fetchImpl: async () =>
      createJsonResponse(200, {
        data: [
          {
            시장명: "말바우시장",
          },
        ],
        currentCount: 1,
        page: 1,
        perPage: 100,
        totalCount: 1,
      }),
  });

  assert.equal(marketContext.found, false);
  assert.equal(marketContext.status, "not_found");
  assert.equal(marketContext.market_name, null);
});

test("getMarketContext falls back gracefully on timeout", async () => {
  const marketContext = await getMarketContext("말바우시장", {
    serviceKey: "test-key",
    fetchImpl: async () => {
      throw new Error("Request timed out after 8000ms");
    },
  });

  assert.equal(marketContext.found, false);
  assert.equal(marketContext.status, "api_error");
  assert.match(marketContext.error ?? "", /timed out/i);
});

test("getMarketContext falls back gracefully on authentication failure", async () => {
  const marketContext = await getMarketContext("말바우시장", {
    serviceKey: "bad-key",
    fetchImpl: async () =>
      createJsonResponse(401, {
        message: "SERVICE_ACCESS_DENIED_ERROR",
      }),
  });

  assert.equal(marketContext.found, false);
  assert.equal(marketContext.status, "api_error");
  assert.match(marketContext.error ?? "", /401/);
});

test("getMarketContext normalizes varied Y/N style fields to booleans", async () => {
  const marketContext = await getMarketContext("말바우시장", {
    serviceKey: "test-key",
    fetchImpl: async () =>
      createJsonResponse(200, {
        data: [
          {
            시장명: "말바우시장",
            아케이드보유여부: "보유",
            "시장전용 고객주차장_보유여부": "없음",
            고객휴게실_보유여부: "1",
            물품보관함_보유여부: "0",
            "외국인 안내센터_보유여부": "미보유",
          },
        ],
        currentCount: 1,
        page: 1,
        perPage: 100,
        totalCount: 1,
      }),
  });

  assert.equal(marketContext.facilities.arcade, true);
  assert.equal(marketContext.facilities.parking, false);
  assert.equal(marketContext.facilities.rest_area, true);
  assert.equal(marketContext.facilities.luggage_storage, false);
  assert.equal(marketContext.facilities.foreigner_information_center, false);
});

test("buildMerchantContext and buildCaptionInputContext combine merchant and market context", async () => {
  const submission = buildSubmission();
  const merchantContext = buildMerchantContext(submission);

  assert.deepEqual(merchantContext, {
    store_name: "행운분식",
    market_name: "말바우 시장",
    product: "떡볶이",
    price: "4,000원",
    features: ["포장 가능", "매일 아침 직접 조리"],
    appeal_point: "포장 가능",
    target_customer: "학생과 직장인",
    peak_sales_time: "오후 간식 시간",
    popular_menu_notes: "매콤달콤한 메뉴를 많이 찾음",
    extra_message: "매일 아침 직접 조리",
  });

  const captionInputContext = await buildCaptionInputContext(submission, {
    marketContextLoader: async () => ({
      found: true,
      status: "found",
      source: "소상공인시장진흥공단_전통시장현황",
      market_code: "a62040004",
      market_name: "말바우시장",
      market_type: "전통시장",
      province: "광주광역시",
      district: "북구",
      road_address: "광주 북구 동문대로 97번길 81",
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
      found: true,
      status: "found",
      source: "기상청_VilageFcstInfoService_2.0",
      latitude: 35.17,
      longitude: 126.91,
      nx: 59,
      ny: 74,
      current: {
        observedAt: "2026-08-19T09:00:00+09:00",
        temperature: 27,
        humidity: 60,
        windSpeed: 1.2,
        windDirection: 90,
        precipitationType: "없음",
        precipitationAmount: null,
      },
      forecast: {
        forecastAt: "2026-08-19T10:00:00+09:00",
        temperature: 28,
        humidity: 58,
        windSpeed: 1.4,
        windDirection: 95,
        sky: "맑음",
        precipitationType: "없음",
        precipitationProbability: 10,
        precipitationAmount: null,
      },
      weather_focus: "clear",
      summary: "28도 맑은 날씨라 가볍게 들르기 좋은 분위기를 활용할 수 있음",
      verified: true,
      selected_for_prompt: true,
      selection_reason: "현재 날씨와 초단기예보가 확인되어 날씨 문맥을 광고에 반영할 수 있음",
      error: null,
    }),
    festivalContextLoader: async () => ({
      found: true,
      source: "한국관광공사_국문 관광정보 서비스_GW",
      content_id: "festival-1",
      title: "광주 야시장 축제",
      event_start_date: "2026-08-19",
      event_end_date: "2026-08-22",
      address: "광주광역시 북구 예시로 1",
      latitude: 35.18,
      longitude: 126.91,
      distance_km: 1.2,
      region_match: true,
      verified: true,
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
  });

  assert.equal(captionInputContext.merchant_context.store_name, "행운분식");
  assert.equal(captionInputContext.market_context.market_name, "말바우시장");
  assert.equal(captionInputContext.weather_context.weather_focus, "clear");
  assert.equal(captionInputContext.market_context.facilities.parking, true);
  assert.equal(captionInputContext.festival_context.title, "광주 야시장 축제");
  assert.equal(captionInputContext.kamis_context.used, false);
});
