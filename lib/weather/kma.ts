import { getWeatherApiEnv } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http";

type KmaItem = {
  baseDate?: string;
  baseTime?: string;
  category?: string;
  nx?: number;
  ny?: number;
  obsrValue?: string;
  fcstDate?: string;
  fcstTime?: string;
  fcstValue?: string;
};

type KmaApiResponse = {
  response?: {
    header?: {
      resultCode?: string;
      resultMsg?: string;
    };
    body?: {
      items?: {
        item?: KmaItem[];
      };
    };
  };
};

export type WeatherGridPoint = {
  nx: number;
  ny: number;
};

export type CurrentWeather = {
  observedAt: string | null;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  precipitationType: string | null;
  precipitationAmount: string | null;
};

export type ForecastWeatherItem = {
  forecastAt: string;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  sky: string | null;
  precipitationType: string | null;
  precipitationProbability: number | null;
  precipitationAmount: string | null;
};

const DFS_RE = 6371.00877;
const DFS_GRID = 5.0;
const DFS_SLAT1 = 30.0;
const DFS_SLAT2 = 60.0;
const DFS_OLON = 126.0;
const DFS_OLAT = 38.0;
const DFS_XO = 43;
const DFS_YO = 136;
const DEG_TO_RAD = Math.PI / 180.0;

function getKstDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

function formatKstDate(date: Date) {
  const parts = getKstDateParts(date);
  return `${parts.year}${parts.month}${parts.day}`;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function resolveUltraSrtNcstBase(date: Date) {
  const parts = getKstDateParts(date);
  const hour = Number.parseInt(parts.hour, 10);
  const minute = Number.parseInt(parts.minute, 10);

  if (minute < 40) {
    const previousHour = addMinutes(date, -60);
    const previousParts = getKstDateParts(previousHour);
    return {
      baseDate: formatKstDate(previousHour),
      baseTime: `${previousParts.hour}00`,
    };
  }

  return {
    baseDate: formatKstDate(date),
    baseTime: `${String(hour).padStart(2, "0")}00`,
  };
}

function resolveUltraSrtFcstBase(date: Date) {
  const parts = getKstDateParts(date);
  const minute = Number.parseInt(parts.minute, 10);

  if (minute < 45) {
    const previousHour = addMinutes(date, -60);
    const previousParts = getKstDateParts(previousHour);
    return {
      baseDate: formatKstDate(previousHour),
      baseTime: `${previousParts.hour}30`,
    };
  }

  return {
    baseDate: formatKstDate(date),
    baseTime: `${parts.hour}30`,
  };
}

function decodeServiceKey(serviceKey: string) {
  try {
    return decodeURIComponent(serviceKey);
  } catch {
    return serviceKey;
  }
}

async function callKmaApi(endpoint: string, params: Record<string, string>) {
  const config = getWeatherApiEnv();

  if (!config.serviceKey) {
    throw new Error("Weather API is not configured");
  }

  const serviceKey = decodeServiceKey(config.serviceKey);
  const url = new URL(`${config.baseUrl.replace(/\/$/, "")}/${endpoint}`);

  const searchParams = new URLSearchParams({
    serviceKey,
    dataType: config.responseFormat,
    pageNo: "1",
    numOfRows: "1000",
    ...params,
  });

  url.search = searchParams.toString();

  const response = await fetchWithTimeout(url, {
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    throw new Error(`Weather API request failed with status ${response.status}`);
  }

  const json = (await response.json()) as KmaApiResponse;
  const resultCode = json.response?.header?.resultCode;
  const resultMsg = json.response?.header?.resultMsg;

  if (resultCode && resultCode !== "00") {
    throw new Error(resultMsg || `Weather API error: ${resultCode}`);
  }

  return json.response?.body?.items?.item ?? [];
}

function numberOrNull(value: string | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function precipitationTypeLabel(code: string | undefined) {
  switch (code) {
    case "0":
      return "없음";
    case "1":
      return "비";
    case "2":
      return "비/눈";
    case "3":
      return "눈";
    case "4":
      return "소나기";
    default:
      return null;
  }
}

function skyLabel(code: string | undefined) {
  switch (code) {
    case "1":
      return "맑음";
    case "3":
      return "구름많음";
    case "4":
      return "흐림";
    default:
      return null;
  }
}

function toIsoLikeKst(datePart: string | undefined, timePart: string | undefined) {
  if (!datePart || !timePart || datePart.length !== 8) {
    return null;
  }

  const normalizedTime = timePart.padStart(4, "0");
  const year = datePart.slice(0, 4);
  const month = datePart.slice(4, 6);
  const day = datePart.slice(6, 8);
  const hour = normalizedTime.slice(0, 2);
  const minute = normalizedTime.slice(2, 4);

  return `${year}-${month}-${day}T${hour}:${minute}:00+09:00`;
}

export function convertLatLonToGrid(lat: number, lon: number): WeatherGridPoint {
  const re = DFS_RE / DFS_GRID;
  const slat1 = DFS_SLAT1 * DEG_TO_RAD;
  const slat2 = DFS_SLAT2 * DEG_TO_RAD;
  const olon = DFS_OLON * DEG_TO_RAD;
  const olat = DFS_OLAT * DEG_TO_RAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);

  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;

  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + lat * DEG_TO_RAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);

  let theta = lon * DEG_TO_RAD - olon;
  if (theta > Math.PI) {
    theta -= 2.0 * Math.PI;
  }
  if (theta < -Math.PI) {
    theta += 2.0 * Math.PI;
  }
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + DFS_XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + DFS_YO + 0.5),
  };
}

export async function getCurrentWeather(nx: number, ny: number, now = new Date()) {
  const { baseDate, baseTime } = resolveUltraSrtNcstBase(now);
  const items = await callKmaApi("getUltraSrtNcst", {
    base_date: baseDate,
    base_time: baseTime,
    nx: String(nx),
    ny: String(ny),
  });

  const findValue = (category: string) =>
    items.find((item) => item.category === category)?.obsrValue;

  return {
    baseDate,
    baseTime,
    current: {
      observedAt: toIsoLikeKst(baseDate, baseTime),
      temperature: numberOrNull(findValue("T1H")),
      humidity: numberOrNull(findValue("REH")),
      windSpeed: numberOrNull(findValue("WSD")),
      windDirection: numberOrNull(findValue("VEC")),
      precipitationType: precipitationTypeLabel(findValue("PTY")),
      precipitationAmount: findValue("RN1") ?? null,
    } satisfies CurrentWeather,
    rawItems: items,
  };
}

export async function getUltraShortForecast(
  nx: number,
  ny: number,
  hours: number,
  now = new Date(),
) {
  const { baseDate, baseTime } = resolveUltraSrtFcstBase(now);
  const items = await callKmaApi("getUltraSrtFcst", {
    base_date: baseDate,
    base_time: baseTime,
    nx: String(nx),
    ny: String(ny),
  });

  const grouped = new Map<string, KmaItem[]>();

  for (const item of items) {
    const key = `${item.fcstDate ?? ""}${item.fcstTime ?? ""}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)?.push(item);
  }

  const forecasts = [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .slice(0, Math.max(1, Math.min(hours, 12)))
    .map(([, group]) => {
      const findValue = (category: string) =>
        group.find((item) => item.category === category)?.fcstValue;

      const sample = group[0];

      return {
        forecastAt:
          toIsoLikeKst(sample.fcstDate, sample.fcstTime) ??
          `${sample.fcstDate}T${sample.fcstTime}`,
        temperature: numberOrNull(findValue("T1H")),
        humidity: numberOrNull(findValue("REH")),
        windSpeed: numberOrNull(findValue("WSD")),
        windDirection: numberOrNull(findValue("VEC")),
        sky: skyLabel(findValue("SKY")),
        precipitationType: precipitationTypeLabel(findValue("PTY")),
        precipitationProbability: numberOrNull(findValue("POP")),
        precipitationAmount: findValue("RN1") ?? null,
      } satisfies ForecastWeatherItem;
    });

  return {
    baseDate,
    baseTime,
    forecast: forecasts,
    rawItems: items,
  };
}
