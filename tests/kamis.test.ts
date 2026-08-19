import assert from "node:assert/strict";
import test from "node:test";

import { buildCaptionInputContext } from "../lib/ai/context.ts";
import type { SubmissionForGeneration } from "../lib/ai/generation.ts";
import {
  __testUtils,
  clearKamisCache,
  getKamisContext,
} from "../lib/public-data/kamis.ts";
import type { MarketContext } from "../lib/public-data/traditional-market.ts";

function createJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function buildMarketContext(
  overrides?: Partial<MarketContext>,
): MarketContext {
  return {
    found: true,
    status: "found",
    source: "소상공인시장진흥공단_전통시장현황",
    market_code: "a62040004",
    market_name: "말바우시장",
    market_type: "전통시장",
    province: "광주광역시",
    district: "북구",
    road_address: "광주광역시 북구 동문대로97번길 55",
    facilities: {
      arcade: true,
      parking: true,
      rest_area: false,
      luggage_storage: false,
      foreigner_information_center: false,
    },
    error: null,
    ...overrides,
  };
}

function buildSubmission(
  targetMenuName: string,
  priceText: string,
): SubmissionForGeneration {
  return {
    id: "submission-1",
    title: null,
    caption: null,
    store_type: "청과점",
    target_menu_name: targetMenuName,
    price_text: priceText,
    appeal_point: "오늘 들어온 신선한 상품",
    extra_message: "매일 아침 직접 들여와요",
    ai_metadata: {
      merchantInsights: {
        targetCustomer: "근처 주민",
        peakSalesTime: "오전 장보기 시간",
        popularMenuNotes: "실속 있는 과일을 많이 찾음",
      },
    },
    stores: {
      market_name: "말바우시장",
      store_name: "행운청과",
      owner_name: null,
    },
  };
}

function createKamisFetch(
  resolver: (url: URL) => Response | Promise<Response>,
) {
  return async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    return resolver(url);
  };
}

function buildKamisItem(overrides?: Record<string, string | undefined>) {
  return {
    exmn_ymd: "20260819",
    se_cd: "01",
    se_nm: "소매",
    ctgry_cd: "400",
    ctgry_nm: "과일류",
    item_cd: "411",
    item_nm: "사과",
    vrty_cd: "00",
    vrty_nm: "사과",
    grd_cd: "04",
    grd_nm: "상품",
    sgg_cd: "2401",
    sgg_nm: "광주",
    unit: "kg",
    unit_sz: "1",
    exmn_dd_min_prc: "6500",
    exmn_dd_cnvs_min_prc: "6500",
    exmn_dd_avg_prc: "7000",
    exmn_dd_cnvs_avg_prc: "7000",
    exmn_dd_max_prc: "7500",
    exmn_dd_cnvs_max_prc: "7500",
    ...overrides,
  };
}

function buildKamisPayload(item: Record<string, string | undefined> | Array<Record<string, string | undefined>>) {
  return {
    response: {
      header: {
        resultCode: "00",
        resultMsg: "NORMAL SERVICE.",
      },
      body: {
        totalCount: Array.isArray(item) ? item.length : 1,
        dataType: "JSON",
        items: {
          item,
        },
        pageNo: 1,
        numOfRows: 100,
      },
    },
  };
}

test.beforeEach(() => {
  process.env.KAMIS_API_SERVICE_KEY = "test-kamis-key";
  process.env.KAMIS_LOOKBACK_DAYS = "7";
});

test.afterEach(() => {
  clearKamisCache();
  delete process.env.KAMIS_API_SERVICE_KEY;
  delete process.env.KAMIS_LOOKBACK_DAYS;
});

test("사과는 KAMIS 조회 후보로 매칭된다", () => {
  const utils = __testUtils();
  const matched = utils.matchMerchantProduct("사과 1kg");
  assert.equal(matched.matched, true);
  assert.equal(matched.itemCode, "411");
  assert.equal(matched.itemName, "사과");
});

test("떡볶이는 KAMIS 조회 대상이 아니다", async () => {
  let called = false;
  const kamisContext = await getKamisContext("떡볶이", buildMarketContext(), {
    serviceKey: "test-kamis-key",
    fetchImpl: async () => {
      called = true;
      return createJsonResponse(200, {});
    },
  });

  assert.equal(called, false);
  assert.equal(kamisContext.used, false);
  assert.equal(kamisContext.reason, "product_not_supported");
});

test("정상 품목 매칭과 광주 지역 조회가 된다", async () => {
  const fetchImpl = createKamisFetch((url) => {
    assert.equal(url.searchParams.get("cond[se_cd::EQ]"), "01");
    assert.equal(url.searchParams.get("cond[item_cd::EQ]"), "411");
    assert.equal(url.searchParams.get("cond[sgg_cd::EQ]"), "2401");
    return createJsonResponse(200, buildKamisPayload(buildKamisItem()));
  });

  const kamisContext = await getKamisContext("사과 1kg", buildMarketContext(), {
    serviceKey: "test-kamis-key",
    fetchImpl,
    now: () => new Date("2026-08-19T09:00:00+09:00"),
  });

  assert.equal(kamisContext.used, true);
  assert.equal(kamisContext.matched_item, "사과");
  assert.equal(kamisContext.region, "광주");
  assert.equal(kamisContext.price_type, "retail");
  assert.equal(kamisContext.latest_price, 7000);
});

test("품목 매칭 실패 시 호출하지 않는다", async () => {
  let called = false;
  const kamisContext = await getKamisContext("카페라떼", buildMarketContext(), {
    serviceKey: "test-kamis-key",
    fetchImpl: async () => {
      called = true;
      return createJsonResponse(200, buildKamisPayload([]));
    },
  });

  assert.equal(called, false);
  assert.equal(kamisContext.reason, "product_not_supported");
});

test("데이터가 없으면 no_recent_price_data로 처리한다", async () => {
  const fetchImpl = createKamisFetch(() =>
    createJsonResponse(200, {
      response: {
        header: {
          resultCode: "00",
          resultMsg: "NORMAL SERVICE.",
        },
        body: {
          totalCount: 0,
          items: {},
          pageNo: 1,
          numOfRows: 100,
        },
      },
    }),
  );

  const kamisContext = await getKamisContext("사과", buildMarketContext(), {
    serviceKey: "test-kamis-key",
    fetchImpl,
  });

  assert.equal(kamisContext.used, false);
  assert.equal(kamisContext.reason, "no_recent_price_data");
});

test("단위가 일치하면 unit_match가 true가 된다", async () => {
  const fetchImpl = createKamisFetch(() =>
    createJsonResponse(200, buildKamisPayload(buildKamisItem())),
  );

  const kamisContext = await getKamisContext("사과 1kg", buildMarketContext(), {
    serviceKey: "test-kamis-key",
    fetchImpl,
  });

  assert.equal(kamisContext.unit_match, true);
});

test("단위가 다르면 unit_match가 false가 된다", async () => {
  const fetchImpl = createKamisFetch(() =>
    createJsonResponse(
      200,
      buildKamisPayload(
        buildKamisItem({
          unit: "개",
          unit_sz: "10",
        }),
      ),
    ),
  );

  const kamisContext = await getKamisContext("사과 1kg", buildMarketContext(), {
    serviceKey: "test-kamis-key",
    fetchImpl,
  });

  assert.equal(kamisContext.unit_match, false);
  assert.equal(kamisContext.price_comparison_allowed, false);
});

test("품종이 달라도 비교 허용은 하지 않는다", async () => {
  const fetchImpl = createKamisFetch(() =>
    createJsonResponse(
      200,
      buildKamisPayload(
        buildKamisItem({
          vrty_cd: "99",
          vrty_nm: "부사",
        }),
      ),
    ),
  );

  const kamisContext = await getKamisContext("사과 1kg", buildMarketContext(), {
    serviceKey: "test-kamis-key",
    fetchImpl,
  });

  assert.equal(kamisContext.variety, "부사");
  assert.equal(kamisContext.price_comparison_allowed, false);
});

test("소매가격을 우선 사용한다", async () => {
  const fetchImpl = createKamisFetch(() =>
    createJsonResponse(
      200,
      buildKamisPayload([
        buildKamisItem({
          se_cd: "02",
          se_nm: "중도매",
          exmn_dd_avg_prc: "5000",
        }),
        buildKamisItem({
          se_cd: "01",
          se_nm: "소매",
          exmn_dd_avg_prc: "7000",
        }),
      ]),
    ),
  );

  const kamisContext = await getKamisContext("사과 1kg", buildMarketContext(), {
    serviceKey: "test-kamis-key",
    fetchImpl,
  });

  assert.equal(kamisContext.price_type, "retail");
  assert.equal(kamisContext.latest_price, 7000);
});

test("API timeout이어도 광고용 컨텍스트는 fallback 된다", async () => {
  const kamisContext = await getKamisContext("사과 1kg", buildMarketContext(), {
    serviceKey: "test-kamis-key",
    fetchImpl: async () => {
      throw new Error("Request timed out after 8000ms");
    },
  });

  assert.equal(kamisContext.used, false);
  assert.equal(kamisContext.reason, "kamis_api_unavailable");
});

test("인증 실패는 fallback 처리된다", async () => {
  const kamisContext = await getKamisContext("사과 1kg", buildMarketContext(), {
    serviceKey: "bad-key",
    fetchImpl: async () => createJsonResponse(401, { message: "Unauthorized" }),
  });

  assert.equal(kamisContext.reason, "kamis_api_unavailable");
});

test("500 오류는 fallback 처리된다", async () => {
  const kamisContext = await getKamisContext("사과 1kg", buildMarketContext(), {
    serviceKey: "test-kamis-key",
    fetchImpl: async () => createJsonResponse(500, { message: "Server error" }),
  });

  assert.equal(kamisContext.reason, "kamis_api_unavailable");
});

test("item 하나 반환도 처리한다", async () => {
  const kamisContext = await getKamisContext("사과", buildMarketContext(), {
    serviceKey: "test-kamis-key",
    fetchImpl: createKamisFetch(() =>
      createJsonResponse(200, buildKamisPayload(buildKamisItem())),
    ),
  });

  assert.equal(kamisContext.used, true);
  assert.equal(kamisContext.matched_item_code, "411");
});

test("item 배열 반환도 처리한다", async () => {
  const kamisContext = await getKamisContext("사과", buildMarketContext(), {
    serviceKey: "test-kamis-key",
    fetchImpl: createKamisFetch(() =>
      createJsonResponse(
        200,
        buildKamisPayload([
          buildKamisItem({ exmn_ymd: "20260818", exmn_dd_avg_prc: "6800" }),
          buildKamisItem({ exmn_ymd: "20260819", exmn_dd_avg_prc: "7000" }),
        ]),
      ),
    ),
  });

  assert.equal(kamisContext.latest_price, 7000);
});

test("최근 데이터가 여러 건이면 평균과 추세를 계산한다", async () => {
  const kamisContext = await getKamisContext("사과", buildMarketContext(), {
    serviceKey: "test-kamis-key",
    fetchImpl: createKamisFetch(() =>
      createJsonResponse(
        200,
        buildKamisPayload([
          buildKamisItem({ exmn_ymd: "20260813", exmn_dd_avg_prc: "6500" }),
          buildKamisItem({ exmn_ymd: "20260815", exmn_dd_avg_prc: "7000" }),
          buildKamisItem({ exmn_ymd: "20260819", exmn_dd_avg_prc: "7500" }),
        ]),
      ),
    ),
  });

  assert.equal(kamisContext.average_price, 7000);
  assert.equal(kamisContext.price_trend, "rising");
});

test("비교 불가능한 데이터로 가격우위 문구 허용하지 않는다", async () => {
  const kamisContext = await getKamisContext("사과 1kg", buildMarketContext(), {
    serviceKey: "test-kamis-key",
    fetchImpl: createKamisFetch(() =>
      createJsonResponse(
        200,
        buildKamisPayload(
          buildKamisItem({
            unit: "개",
            unit_sz: "10",
            grd_nm: "중품",
          }),
        ),
      ),
    ),
  });

  assert.equal(kamisContext.price_comparison_allowed, false);
  assert.equal(kamisContext.selected_for_prompt, true);
});

test("KAMIS 실패 후에도 buildCaptionInputContext는 정상적으로 완료된다", async () => {
  const submission = buildSubmission("사과 1kg", "7,000원");
  const captionInputContext = await buildCaptionInputContext(submission, {
    marketContextLoader: async () => buildMarketContext(),
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
      weather_focus: null,
      summary: null,
      verified: false,
      selected_for_prompt: false,
      selection_reason: "상점 좌표가 없어 날씨 문맥은 사용하지 않음",
      reason: "missing_coordinates",
      error: null,
    }),
    festivalContextLoader: async () => ({
      found: false,
      source: "한국관광공사_국문 관광정보 서비스_GW",
      reason: "no_relevant_festival",
    }),
    kamisContextLoader: async () => ({
      used: false,
      source: "한국농수산식품유통공사_지역별 품목별 도소매 가격정보",
      matched: true,
      merchant_product: "사과 1kg",
      matched_item: "사과",
      matched_item_code: "411",
      region: "광주",
      region_code: "2401",
      price_type: "retail",
      period_start: "2026-08-13",
      period_end: "2026-08-19",
      unit: null,
      unit_size: null,
      grade: null,
      variety: null,
      latest_price: null,
      average_price: null,
      latest_price_date: null,
      price_trend: null,
      unit_match: false,
      region_match: true,
      price_comparison_allowed: false,
      verified: false,
      selected_for_prompt: false,
      selection_reason: "광고 전략에 활용할 만한 KAMIS 가격 컨텍스트가 충분하지 않음",
      reason: "kamis_api_unavailable",
    }),
  });

  assert.equal(captionInputContext.kamis_context.reason, "kamis_api_unavailable");
  assert.equal(captionInputContext.selected_context.kamis, false);
});

test("CASE A: 사과는 KAMIS 컨텍스트가 활성화된다", async () => {
  const submission = buildSubmission("사과 1kg", "7,000원");
  const captionInputContext = await buildCaptionInputContext(submission, {
    marketContextLoader: async () => buildMarketContext(),
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
      weather_focus: null,
      summary: null,
      verified: false,
      selected_for_prompt: false,
      selection_reason: "상점 좌표가 없어 날씨 문맥은 사용하지 않음",
      reason: "missing_coordinates",
      error: null,
    }),
    festivalContextLoader: async () => ({
      found: false,
      source: "한국관광공사_국문 관광정보 서비스_GW",
      reason: "no_relevant_festival",
    }),
    kamisContextLoader: async () => ({
      used: true,
      source: "한국농수산식품유통공사_지역별 품목별 도소매 가격정보",
      matched: true,
      merchant_product: "사과 1kg",
      matched_item: "사과",
      matched_item_code: "411",
      region: "광주",
      region_code: "2401",
      price_type: "retail",
      period_start: "2026-08-13",
      period_end: "2026-08-19",
      unit: "kg",
      unit_size: "1",
      grade: "상품",
      variety: "사과",
      latest_price: 7000,
      average_price: 6900,
      latest_price_date: "2026-08-19",
      price_trend: "stable",
      unit_match: true,
      region_match: true,
      price_comparison_allowed: false,
      verified: true,
      selected_for_prompt: true,
      selection_reason: "사용자 상품이 KAMIS 조회 가능 품목이며 최근 지역 소매가격 데이터가 확인됨",
    }),
  });

  assert.equal(captionInputContext.kamis_context.used, true);
  assert.equal(captionInputContext.selected_context.kamis, true);
});

test("CASE B: 떡볶이는 KAMIS 컨텍스트가 비활성화된다", async () => {
  const submission = buildSubmission("떡볶이", "4,000원");
  const captionInputContext = await buildCaptionInputContext(submission, {
    marketContextLoader: async () => buildMarketContext(),
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
      weather_focus: null,
      summary: null,
      verified: false,
      selected_for_prompt: false,
      selection_reason: "상점 좌표가 없어 날씨 문맥은 사용하지 않음",
      reason: "missing_coordinates",
      error: null,
    }),
    festivalContextLoader: async () => ({
      found: false,
      source: "한국관광공사_국문 관광정보 서비스_GW",
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
  });

  assert.equal(captionInputContext.kamis_context.used, false);
  assert.equal(captionInputContext.selected_context.kamis, false);
});
