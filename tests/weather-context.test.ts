import assert from "node:assert/strict";
import test from "node:test";

import { getWeatherContext } from "../lib/weather/context.ts";
import type { MarketContext } from "../lib/public-data/traditional-market.ts";

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

test("getWeatherContext reflects rainy weather when precipitation exists", async () => {
  const weatherContext = await getWeatherContext(buildMarketContext(), {
    currentWeatherLoader: async () => ({
      baseDate: "20260819",
      baseTime: "0900",
      current: {
        observedAt: "2026-08-19T09:00:00+09:00",
        temperature: 25,
        humidity: 88,
        windSpeed: 1.3,
        windDirection: 120,
        precipitationType: "비",
        precipitationAmount: "1mm 미만",
      },
      rawItems: [],
    }),
    forecastLoader: async () => ({
      baseDate: "20260819",
      baseTime: "0830",
      forecast: [
        {
          forecastAt: "2026-08-19T10:00:00+09:00",
          temperature: 24,
          humidity: 90,
          windSpeed: 1.2,
          windDirection: 110,
          sky: "흐림",
          precipitationType: "비",
          precipitationProbability: 80,
          precipitationAmount: "1mm 미만",
        },
      ],
      rawItems: [],
    }),
  });

  assert.equal(weatherContext.found, true);
  assert.equal(weatherContext.weather_focus, "rain");
  assert.equal(weatherContext.selected_for_prompt, true);
  assert.match(weatherContext.summary ?? "", /비 소식/);
});

test("getWeatherContext returns not_found when coordinates are missing", async () => {
  const weatherContext = await getWeatherContext(
    buildMarketContext({
      latitude: null,
      longitude: null,
    }),
  );

  assert.equal(weatherContext.found, false);
  assert.equal(weatherContext.status, "not_found");
  assert.equal(weatherContext.reason, "missing_coordinates");
});

test("getWeatherContext falls back gracefully when weather API fails", async () => {
  const weatherContext = await getWeatherContext(buildMarketContext(), {
    currentWeatherLoader: async () => {
      throw new Error("Weather API request failed with status 500");
    },
    forecastLoader: async () => ({
      baseDate: "20260819",
      baseTime: "0830",
      forecast: [],
      rawItems: [],
    }),
  });

  assert.equal(weatherContext.found, false);
  assert.equal(weatherContext.status, "api_error");
  assert.equal(weatherContext.reason, "weather_api_unavailable");
});
