import {
  convertLatLonToGrid,
  getCurrentWeather,
  getUltraShortForecast,
  type CurrentWeather,
  type ForecastWeatherItem,
} from "@/lib/weather/kma";

import type { MarketContext } from "@/lib/public-data/traditional-market";

const WEATHER_SOURCE_NAME = "기상청_VilageFcstInfoService_2.0";

export type WeatherContext = {
  found: boolean;
  status: "found" | "not_found" | "api_error" | "not_configured";
  source: string;
  latitude: number | null;
  longitude: number | null;
  nx: number | null;
  ny: number | null;
  current: CurrentWeather | null;
  forecast: ForecastWeatherItem | null;
  weather_focus: "rain" | "snow" | "hot" | "cold" | "clear" | "cloudy" | null;
  summary: string | null;
  verified: boolean;
  selected_for_prompt: boolean;
  selection_reason: string | null;
  reason?: "missing_coordinates" | "weather_api_unavailable";
  error: string | null;
};

type WeatherContextDeps = {
  currentWeatherLoader?: typeof getCurrentWeather;
  forecastLoader?: typeof getUltraShortForecast;
};

function buildNotFoundWeatherContext(
  reason: WeatherContext["reason"],
  selectionReason: string,
): WeatherContext {
  return {
    found: false,
    status: "not_found",
    source: WEATHER_SOURCE_NAME,
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
    selection_reason: selectionReason,
    reason,
    error: null,
  };
}

function buildWeatherApiErrorContext(message: string): WeatherContext {
  return {
    found: false,
    status: /not configured/i.test(message) ? "not_configured" : "api_error",
    source: WEATHER_SOURCE_NAME,
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
    selection_reason: "날씨 데이터를 사용할 수 없어 상인 입력 중심으로 생성",
    reason: "weather_api_unavailable",
    error: message,
  };
}

function pickWeatherFocus(
  current: CurrentWeather | null,
  forecast: ForecastWeatherItem | null,
): WeatherContext["weather_focus"] {
  const precipitation =
    current?.precipitationType && current.precipitationType !== "없음"
      ? current.precipitationType
      : forecast?.precipitationType && forecast.precipitationType !== "없음"
        ? forecast.precipitationType
        : null;

  if (precipitation === "비" || precipitation === "소나기" || precipitation === "비/눈") {
    return "rain";
  }

  if (precipitation === "눈") {
    return "snow";
  }

  const temperature = current?.temperature ?? forecast?.temperature ?? null;

  if (typeof temperature === "number") {
    if (temperature >= 28) {
      return "hot";
    }

    if (temperature <= 8) {
      return "cold";
    }
  }

  if (forecast?.sky === "맑음") {
    return "clear";
  }

  if (forecast?.sky === "구름많음" || forecast?.sky === "흐림") {
    return "cloudy";
  }

  return null;
}

function buildWeatherSummary(
  focus: WeatherContext["weather_focus"],
  current: CurrentWeather | null,
  forecast: ForecastWeatherItem | null,
) {
  const temperature = current?.temperature ?? forecast?.temperature ?? null;
  const temperatureText =
    typeof temperature === "number" ? `${Math.round(temperature)}도` : null;

  switch (focus) {
    case "rain":
      return temperatureText
        ? `비 소식이 있어 ${temperatureText} 안팎 날씨에 어울리는 메뉴 맥락을 활용할 수 있음`
        : "비 소식이 있어 실내 방문이나 따뜻한 메뉴 맥락을 활용할 수 있음";
    case "snow":
      return temperatureText
        ? `눈 소식이 있어 ${temperatureText} 안팎의 쌀쌀한 날씨 맥락을 활용할 수 있음`
        : "눈 소식이 있어 따뜻한 메뉴나 실내 방문 맥락을 활용할 수 있음";
    case "hot":
      return temperatureText
        ? `${temperatureText} 무더운 날씨라 가볍고 시원한 한 끼 또는 포장 수요 맥락을 활용할 수 있음`
        : "무더운 날씨라 가볍고 편한 방문 맥락을 활용할 수 있음";
    case "cold":
      return temperatureText
        ? `${temperatureText}로 다소 쌀쌀해 따뜻한 메뉴 맥락을 활용할 수 있음`
        : "쌀쌀한 날씨라 따뜻한 메뉴 맥락을 활용할 수 있음";
    case "clear":
      return temperatureText
        ? `${temperatureText} 맑은 날씨라 가볍게 들르기 좋은 분위기를 활용할 수 있음`
        : "맑은 날씨라 가볍게 들르기 좋은 분위기를 활용할 수 있음";
    case "cloudy":
      return temperatureText
        ? `${temperatureText} 흐린 날씨라 편하게 한 끼 해결하기 좋은 분위기를 활용할 수 있음`
        : "흐린 날씨라 편하게 들르기 좋은 분위기를 활용할 수 있음";
    default:
      return null;
  }
}

export async function getWeatherContext(
  marketContext: MarketContext,
  deps?: WeatherContextDeps,
): Promise<WeatherContext> {
  if (
    typeof marketContext.latitude !== "number" ||
    !Number.isFinite(marketContext.latitude) ||
    typeof marketContext.longitude !== "number" ||
    !Number.isFinite(marketContext.longitude)
  ) {
    return buildNotFoundWeatherContext(
      "missing_coordinates",
      "상점 좌표가 없어 날씨 문맥은 사용하지 않음",
    );
  }

  try {
    const grid = convertLatLonToGrid(
      marketContext.latitude,
      marketContext.longitude,
    );
    const currentWeatherLoader = deps?.currentWeatherLoader ?? getCurrentWeather;
    const forecastLoader = deps?.forecastLoader ?? getUltraShortForecast;
    const [currentResult, forecastResult] = await Promise.all([
      currentWeatherLoader(grid.nx, grid.ny),
      forecastLoader(grid.nx, grid.ny, 6),
    ]);
    const forecast = forecastResult.forecast[0] ?? null;
    const weatherFocus = pickWeatherFocus(currentResult.current, forecast);
    const summary = buildWeatherSummary(
      weatherFocus,
      currentResult.current,
      forecast,
    );

    return {
      found: true,
      status: "found",
      source: WEATHER_SOURCE_NAME,
      latitude: marketContext.latitude,
      longitude: marketContext.longitude,
      nx: grid.nx,
      ny: grid.ny,
      current: currentResult.current,
      forecast,
      weather_focus: weatherFocus,
      summary,
      verified: true,
      selected_for_prompt: weatherFocus !== null,
      selection_reason:
        weatherFocus !== null
          ? "현재 날씨와 초단기예보가 확인되어 날씨 문맥을 광고에 반영할 수 있음"
          : "날씨 조회는 성공했지만 광고에 반영할 만큼 뚜렷한 날씨 포인트가 없음",
      error: null,
    };
  } catch (error) {
    return buildWeatherApiErrorContext(
      error instanceof Error ? error.message : "Weather API error",
    );
  }
}
