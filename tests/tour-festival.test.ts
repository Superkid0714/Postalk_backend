import assert from "node:assert/strict";
import test from "node:test";

import { buildCaptionInputContext } from "../lib/ai/context.ts";
import {
  clearFestivalCache,
  getFestivalContext,
} from "../lib/public-data/tour-festival.ts";
import type { SubmissionForGeneration } from "../lib/ai/generation.ts";
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
    ...overrides,
  };
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
      market_name: "말바우시장",
      store_name: "행운분식",
      owner_name: null,
    },
  };
}

function createTourApiFetch(resolver: (url: URL) => Response | Promise<Response>) {
  return async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    return resolver(url);
  };
}

function buildLdongProvinceResponse() {
  return createJsonResponse(200, {
    response: {
      header: {
        resultCode: "0000",
        resultMsg: "OK",
      },
      body: {
        pageNo: 1,
        numOfRows: 100,
        totalCount: 1,
        items: {
          item: {
            lDongRegnCd: "24",
            lDongRegnNm: "광주광역시",
          },
        },
      },
    },
  });
}

function buildLdongDistrictResponse() {
  return createJsonResponse(200, {
    response: {
      header: {
        resultCode: "0000",
        resultMsg: "OK",
      },
      body: {
        pageNo: 1,
        numOfRows: 100,
        totalCount: 1,
        items: {
          item: {
            lDongRegnCd: "24",
            lDongSignguCd: "2401",
            lDongSignguNm: "북구",
          },
        },
      },
    },
  });
}

function buildSearchFestivalResponse(item: FestivalItemMock | FestivalItemMock[]) {
  return createJsonResponse(200, {
    response: {
      header: {
        resultCode: "0000",
        resultMsg: "OK",
      },
      body: {
        pageNo: 1,
        numOfRows: 100,
        totalCount: Array.isArray(item) ? item.length : 1,
        items: {
          item,
        },
      },
    },
  });
}

function buildDetailCommonResponse(item: Record<string, unknown>) {
  return createJsonResponse(200, {
    response: {
      header: {
        resultCode: "0000",
        resultMsg: "OK",
      },
      body: {
        pageNo: 1,
        numOfRows: 10,
        totalCount: 1,
        items: {
          item,
        },
      },
    },
  });
}

type FestivalItemMock = {
  contentid: string;
  contenttypeid?: string;
  title: string;
  addr1?: string;
  addr2?: string;
  eventstartdate: string;
  eventenddate: string;
  mapx?: string;
  mapy?: string;
  lDongRegnCd?: string;
  lDongSignguCd?: string;
};

function buildFestivalItem(overrides?: Partial<FestivalItemMock>): FestivalItemMock {
  return {
    contentid: "festival-1",
    contenttypeid: "15",
    title: "광주 야시장 축제",
    addr1: "광주광역시 북구 축제거리 1",
    addr2: "",
    eventstartdate: "20260819",
    eventenddate: "20260821",
    mapx: "126.9120",
    mapy: "35.1740",
    lDongRegnCd: "24",
    lDongSignguCd: "2401",
    ...overrides,
  };
}

test.beforeEach(() => {
  process.env.TOUR_API_SERVICE_KEY = "test-tour-key";
  process.env.FESTIVAL_LOOKAHEAD_DAYS = "7";
  process.env.FESTIVAL_MAX_DISTANCE_KM = "5";
});

test.afterEach(() => {
  clearFestivalCache();
  delete process.env.TOUR_API_SERVICE_KEY;
  delete process.env.FESTIVAL_LOOKAHEAD_DAYS;
  delete process.env.FESTIVAL_MAX_DISTANCE_KM;
});

test("getFestivalContext picks an ongoing festival when one exists", async () => {
  const fetchImpl = createTourApiFetch((url) => {
    if (url.pathname.endsWith("/ldongCode2")) {
      return url.searchParams.get("lDongRegnCd")
        ? buildLdongDistrictResponse()
        : buildLdongProvinceResponse();
    }

    if (url.pathname.endsWith("/searchFestival2")) {
      return buildSearchFestivalResponse(buildFestivalItem());
    }

    throw new Error(`Unhandled path: ${url.pathname}`);
  });

  const festivalContext = await getFestivalContext(buildMarketContext(), {
    serviceKey: "test-tour-key",
    fetchImpl,
    now: () => new Date("2026-08-19T09:00:00+09:00"),
  });

  assert.equal(festivalContext.found, true);
  assert.equal(festivalContext.title, "광주 야시장 축제");
  assert.equal(festivalContext.event_start_date, "2026-08-19");
  assert.equal(festivalContext.region_match, true);
  assert.equal(festivalContext.verified, true);
});

test("getFestivalContext returns a festival within the next 7 days", async () => {
  const fetchImpl = createTourApiFetch((url) => {
    if (url.pathname.endsWith("/ldongCode2")) {
      return url.searchParams.get("lDongRegnCd")
        ? buildLdongDistrictResponse()
        : buildLdongProvinceResponse();
    }

    if (url.pathname.endsWith("/searchFestival2")) {
      return buildSearchFestivalResponse(
        buildFestivalItem({
          contentid: "festival-2",
          title: "광주 주말 축제",
          eventstartdate: "20260824",
          eventenddate: "20260826",
        }),
      );
    }

    throw new Error(`Unhandled path: ${url.pathname}`);
  });

  const festivalContext = await getFestivalContext(buildMarketContext(), {
    serviceKey: "test-tour-key",
    fetchImpl,
    now: () => new Date("2026-08-19T09:00:00+09:00"),
  });

  assert.equal(festivalContext.found, true);
  assert.equal(festivalContext.title, "광주 주말 축제");
  assert.equal(festivalContext.event_start_date, "2026-08-24");
});

test("getFestivalContext returns not found when there is no relevant festival", async () => {
  const fetchImpl = createTourApiFetch((url) => {
    if (url.pathname.endsWith("/ldongCode2")) {
      return url.searchParams.get("lDongRegnCd")
        ? buildLdongDistrictResponse()
        : buildLdongProvinceResponse();
    }

    if (url.pathname.endsWith("/searchFestival2")) {
      return createJsonResponse(200, {
        response: {
          header: {
            resultCode: "0000",
            resultMsg: "OK",
          },
          body: {
            pageNo: 1,
            numOfRows: 100,
            totalCount: 0,
          },
        },
      });
    }

    throw new Error(`Unhandled path: ${url.pathname}`);
  });

  const festivalContext = await getFestivalContext(buildMarketContext(), {
    serviceKey: "test-tour-key",
    fetchImpl,
    now: () => new Date("2026-08-19T09:00:00+09:00"),
  });

  assert.equal(festivalContext.found, false);
  assert.equal(festivalContext.reason, "no_relevant_festival");
});

test("getFestivalContext ignores festivals from a different region", async () => {
  const fetchImpl = createTourApiFetch((url) => {
    if (url.pathname.endsWith("/ldongCode2")) {
      return url.searchParams.get("lDongRegnCd")
        ? buildLdongDistrictResponse()
        : buildLdongProvinceResponse();
    }

    if (url.pathname.endsWith("/searchFestival2")) {
      return buildSearchFestivalResponse(
        buildFestivalItem({
          addr1: "전라남도 순천시 축제거리 1",
          lDongRegnCd: "36",
          lDongSignguCd: "3601",
        }),
      );
    }

    throw new Error(`Unhandled path: ${url.pathname}`);
  });

  const festivalContext = await getFestivalContext(buildMarketContext(), {
    serviceKey: "test-tour-key",
    fetchImpl,
    now: () => new Date("2026-08-19T09:00:00+09:00"),
  });

  assert.equal(festivalContext.found, false);
  assert.equal(festivalContext.reason, "no_relevant_festival");
});

test("getFestivalContext keeps a festival within 5km", async () => {
  const fetchImpl = createTourApiFetch((url) => {
    if (url.pathname.endsWith("/ldongCode2")) {
      return url.searchParams.get("lDongRegnCd")
        ? buildLdongDistrictResponse()
        : buildLdongProvinceResponse();
    }

    if (url.pathname.endsWith("/searchFestival2")) {
      return buildSearchFestivalResponse(
        buildFestivalItem({
          mapx: "126.9130",
          mapy: "35.1750",
        }),
      );
    }

    throw new Error(`Unhandled path: ${url.pathname}`);
  });

  const festivalContext = await getFestivalContext(buildMarketContext(), {
    serviceKey: "test-tour-key",
    fetchImpl,
    now: () => new Date("2026-08-19T09:00:00+09:00"),
  });

  assert.equal(festivalContext.found, true);
  assert.equal(typeof festivalContext.distance_km, "number");
  assert.ok((festivalContext.distance_km ?? 99) <= 5);
});

test("getFestivalContext excludes a festival beyond 5km", async () => {
  const fetchImpl = createTourApiFetch((url) => {
    if (url.pathname.endsWith("/ldongCode2")) {
      return url.searchParams.get("lDongRegnCd")
        ? buildLdongDistrictResponse()
        : buildLdongProvinceResponse();
    }

    if (url.pathname.endsWith("/searchFestival2")) {
      return buildSearchFestivalResponse(
        buildFestivalItem({
          mapx: "126.9900",
          mapy: "35.2200",
        }),
      );
    }

    throw new Error(`Unhandled path: ${url.pathname}`);
  });

  const festivalContext = await getFestivalContext(buildMarketContext(), {
    serviceKey: "test-tour-key",
    fetchImpl,
    now: () => new Date("2026-08-19T09:00:00+09:00"),
  });

  assert.equal(festivalContext.found, false);
  assert.equal(festivalContext.reason, "no_relevant_festival");
});

test("getFestivalContext falls back gracefully on timeout", async () => {
  const festivalContext = await getFestivalContext(buildMarketContext(), {
    serviceKey: "test-tour-key",
    fetchImpl: async () => {
      throw new Error("Request timed out after 8000ms");
    },
    now: () => new Date("2026-08-19T09:00:00+09:00"),
  });

  assert.equal(festivalContext.found, false);
  assert.equal(festivalContext.reason, "festival_api_unavailable");
});

test("getFestivalContext falls back gracefully on authentication failure", async () => {
  const festivalContext = await getFestivalContext(buildMarketContext(), {
    serviceKey: "bad-key",
    fetchImpl: async () => createJsonResponse(401, { message: "Unauthorized" }),
    now: () => new Date("2026-08-19T09:00:00+09:00"),
  });

  assert.equal(festivalContext.found, false);
  assert.equal(festivalContext.reason, "festival_api_unavailable");
});

test("getFestivalContext falls back gracefully on 500 responses", async () => {
  const festivalContext = await getFestivalContext(buildMarketContext(), {
    serviceKey: "test-tour-key",
    fetchImpl: async () => createJsonResponse(500, { message: "Server error" }),
    now: () => new Date("2026-08-19T09:00:00+09:00"),
  });

  assert.equal(festivalContext.found, false);
  assert.equal(festivalContext.reason, "festival_api_unavailable");
});

test("getFestivalContext supports searchFestival2 item as a single object", async () => {
  const fetchImpl = createTourApiFetch((url) => {
    if (url.pathname.endsWith("/ldongCode2")) {
      return url.searchParams.get("lDongRegnCd")
        ? buildLdongDistrictResponse()
        : buildLdongProvinceResponse();
    }

    if (url.pathname.endsWith("/searchFestival2")) {
      return buildSearchFestivalResponse(buildFestivalItem());
    }

    throw new Error(`Unhandled path: ${url.pathname}`);
  });

  const festivalContext = await getFestivalContext(buildMarketContext(), {
    serviceKey: "test-tour-key",
    fetchImpl,
    now: () => new Date("2026-08-19T09:00:00+09:00"),
  });

  assert.equal(festivalContext.found, true);
  assert.equal(festivalContext.content_id, "festival-1");
});

test("getFestivalContext supports searchFestival2 item as an array", async () => {
  const fetchImpl = createTourApiFetch((url) => {
    if (url.pathname.endsWith("/ldongCode2")) {
      return url.searchParams.get("lDongRegnCd")
        ? buildLdongDistrictResponse()
        : buildLdongProvinceResponse();
    }

    if (url.pathname.endsWith("/searchFestival2")) {
      return buildSearchFestivalResponse([
        buildFestivalItem({
          contentid: "festival-far",
          title: "먼 축제",
          mapx: "126.9900",
          mapy: "35.2200",
        }),
        buildFestivalItem({
          contentid: "festival-near",
          title: "가까운 축제",
          mapx: "126.9130",
          mapy: "35.1750",
        }),
      ]);
    }

    throw new Error(`Unhandled path: ${url.pathname}`);
  });

  const festivalContext = await getFestivalContext(buildMarketContext(), {
    serviceKey: "test-tour-key",
    fetchImpl,
    now: () => new Date("2026-08-19T09:00:00+09:00"),
  });

  assert.equal(festivalContext.found, true);
  assert.equal(festivalContext.content_id, "festival-near");
});

test("getFestivalContext fills missing coordinates and address from detailCommon2", async () => {
  const fetchImpl = createTourApiFetch((url) => {
    if (url.pathname.endsWith("/ldongCode2")) {
      return url.searchParams.get("lDongRegnCd")
        ? buildLdongDistrictResponse()
        : buildLdongProvinceResponse();
    }

    if (url.pathname.endsWith("/searchFestival2")) {
      return buildSearchFestivalResponse(
        buildFestivalItem({
          addr1: "",
          mapx: undefined,
          mapy: undefined,
        }),
      );
    }

    if (url.pathname.endsWith("/detailCommon2")) {
      return buildDetailCommonResponse({
        addr1: "광주광역시 북구 보강거리 9",
        addr2: "",
        mapx: "126.9125",
        mapy: "35.1743",
      });
    }

    throw new Error(`Unhandled path: ${url.pathname}`);
  });

  const festivalContext = await getFestivalContext(buildMarketContext(), {
    serviceKey: "test-tour-key",
    fetchImpl,
    now: () => new Date("2026-08-19T09:00:00+09:00"),
  });

  assert.equal(festivalContext.found, true);
  assert.equal(festivalContext.address, "광주광역시 북구 보강거리 9");
  assert.equal(typeof festivalContext.distance_km, "number");
});

test("getFestivalContext keeps distance as null when the market has no coordinates", async () => {
  const fetchImpl = createTourApiFetch((url) => {
    if (url.pathname.endsWith("/ldongCode2")) {
      return url.searchParams.get("lDongRegnCd")
        ? buildLdongDistrictResponse()
        : buildLdongProvinceResponse();
    }

    if (url.pathname.endsWith("/searchFestival2")) {
      return buildSearchFestivalResponse(buildFestivalItem());
    }

    throw new Error(`Unhandled path: ${url.pathname}`);
  });

  const festivalContext = await getFestivalContext(
    buildMarketContext({
      latitude: null,
      longitude: null,
    }),
    {
      serviceKey: "test-tour-key",
      fetchImpl,
      now: () => new Date("2026-08-19T09:00:00+09:00"),
    },
  );

  assert.equal(festivalContext.found, true);
  assert.equal(festivalContext.distance_km, null);
});

test("buildCaptionInputContext combines merchant, market, and festival context", async () => {
  const submission = buildSubmission();

  const captionInputContext = await buildCaptionInputContext(submission, {
    marketContextLoader: async () => buildMarketContext(),
    weatherContextLoader: async () => ({
      found: true,
      status: "found",
      source: "기상청_VilageFcstInfoService_2.0",
      latitude: 35.1735,
      longitude: 126.911,
      nx: 59,
      ny: 74,
      current: {
        observedAt: "2026-08-19T09:00:00+09:00",
        temperature: 29,
        humidity: 62,
        windSpeed: 1.7,
        windDirection: 100,
        precipitationType: "없음",
        precipitationAmount: null,
      },
      forecast: {
        forecastAt: "2026-08-19T10:00:00+09:00",
        temperature: 30,
        humidity: 59,
        windSpeed: 1.9,
        windDirection: 110,
        sky: "맑음",
        precipitationType: "없음",
        precipitationProbability: 10,
        precipitationAmount: null,
      },
      weather_focus: "hot",
      summary: "30도 무더운 날씨라 가볍고 시원한 한 끼 또는 포장 수요 맥락을 활용할 수 있음",
      verified: true,
      selected_for_prompt: true,
      selection_reason: "현재 날씨와 초단기예보가 확인되어 날씨 문맥을 광고에 반영할 수 있음",
      error: null,
    }),
    festivalContextLoader: async () => ({
      found: true,
      source: "한국관광공사_국문 관광정보 서비스_GW",
      content_id: "festival-merge",
      title: "광주 문화축제",
      event_start_date: "2026-08-20",
      event_end_date: "2026-08-23",
      address: "광주광역시 북구 문화로 10",
      latitude: 35.174,
      longitude: 126.913,
      distance_km: 1.3,
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

  assert.equal(captionInputContext.merchant_context.product, "떡볶이");
  assert.equal(captionInputContext.market_context.market_name, "말바우시장");
  assert.equal(captionInputContext.weather_context.weather_focus, "hot");
  assert.equal(captionInputContext.festival_context.title, "광주 문화축제");
  assert.equal(captionInputContext.kamis_context.used, false);
});
