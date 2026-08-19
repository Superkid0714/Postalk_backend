import type { NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api/response";
import {
  convertLatLonToGrid,
  getCurrentWeather,
  getUltraShortForecast,
} from "@/lib/weather/kma";

function parseNumber(value: string | null) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: NextRequest) {
  const lat = parseNumber(request.nextUrl.searchParams.get("lat"));
  const lon = parseNumber(request.nextUrl.searchParams.get("lon"));
  const nx = parseNumber(request.nextUrl.searchParams.get("nx"));
  const ny = parseNumber(request.nextUrl.searchParams.get("ny"));
  const hours = parseNumber(request.nextUrl.searchParams.get("hours")) ?? 6;

  if ((lat === null || lon === null) && (nx === null || ny === null)) {
    return errorResponse("lat/lon 또는 nx/ny가 필요합니다", 400, {
      code: "VALIDATION_ERROR",
      details: [
        {
          field: "lat,lon,nx,ny",
          reason: "Provide either lat/lon or nx/ny",
        },
      ],
    });
  }

  try {
    const grid =
      lat !== null && lon !== null
        ? convertLatLonToGrid(lat, lon)
        : {
            nx: Math.round(nx!),
            ny: Math.round(ny!),
          };

    const [currentResult, forecastResult] = await Promise.all([
      getCurrentWeather(grid.nx, grid.ny),
      getUltraShortForecast(grid.nx, grid.ny, Math.round(hours)),
    ]);

    return successResponse(
      {
        location: {
          lat,
          lon,
          nx: grid.nx,
          ny: grid.ny,
        },
        source: {
          provider: "KMA VilageFcstInfoService_2.0",
          currentEndpoint: "getUltraSrtNcst",
          forecastEndpoint: "getUltraSrtFcst",
        },
        currentBase: {
          baseDate: currentResult.baseDate,
          baseTime: currentResult.baseTime,
        },
        forecastBase: {
          baseDate: forecastResult.baseDate,
          baseTime: forecastResult.baseTime,
        },
        current: currentResult.current,
        forecast: forecastResult.forecast,
      },
      "Weather loaded",
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Weather request failed";

    return errorResponse("날씨 조회에 실패했습니다", 500, {
      code: "WEATHER_FETCH_FAILED",
      details: message,
    });
  }
}
