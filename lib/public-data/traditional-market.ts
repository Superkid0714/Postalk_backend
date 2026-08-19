import { getDataGoKrServiceKey } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http";

const BASE_URL = "https://api.odcloud.kr/api";
const DATASET_PATH = "/15052837/v1/uddi:1fd54eb7-0565-4755-8ec7-a70931b6dc77";
const SOURCE_NAME = "소상공인시장진흥공단_전통시장현황";
const DEFAULT_PER_PAGE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000;

type JsonRecord = Record<string, unknown>;

type TraditionalMarketApiResponse = {
  data?: JsonRecord[];
  currentCount?: number;
  matchCount?: number;
  page?: number;
  perPage?: number;
  totalCount?: number;
};

export type MarketContext = {
  found: boolean;
  status: "found" | "not_found" | "api_error";
  source: string;
  market_code: string | null;
  market_name: string | null;
  market_type: string | null;
  province: string | null;
  district: string | null;
  road_address: string | null;
  latitude?: number | null;
  longitude?: number | null;
  facilities: {
    arcade: boolean | null;
    parking: boolean | null;
    rest_area: boolean | null;
    luggage_storage: boolean | null;
    foreigner_information_center: boolean | null;
  };
  error: string | null;
};

export type CaptionEvidenceItem = {
  type: "merchant" | "market" | "weather" | "festival" | "kamis" | "tourism_corpus";
  source: string;
  value: string;
  field?: string;
};

type TraditionalMarketClientDeps = {
  fetchImpl?: typeof fetchWithTimeout;
  serviceKey?: string | null;
  now?: () => number;
};

type TraditionalMarketPageResult = {
  data: JsonRecord[];
  currentCount: number;
  page: number;
  perPage: number;
  totalCount: number | null;
};

const pageCache = new Map<string, { expiresAt: number; value: TraditionalMarketPageResult }>();
const lookupCache = new Map<string, { expiresAt: number; value: MarketContext }>();

function getNow(deps?: TraditionalMarketClientDeps) {
  return deps?.now ? deps.now() : Date.now();
}

function getString(record: JsonRecord, aliases: string[]) {
  for (const alias of aliases) {
    const value = record[alias];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function normalizeWhitespace(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizeMarketName(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[()\-_/.,·]/g, "")
    .replace(/\s+/g, "")
    .replace(/전통시장$/g, "")
    .replace(/시장$/g, "");
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeWhitespace(value).toLowerCase();

  if (
    ["y", "yes", "true", "1", "o", "보유", "있음", "유", "운영"].includes(
      normalized,
    )
  ) {
    return true;
  }

  if (
    ["n", "no", "false", "0", "x", "미보유", "없음", "무", "비운영"].includes(
      normalized,
    )
  ) {
    return false;
  }

  return null;
}

function buildNotFoundMarketContext(): MarketContext {
  return {
    found: false,
    status: "not_found",
    source: SOURCE_NAME,
    market_code: null,
    market_name: null,
    market_type: null,
    province: null,
    district: null,
    road_address: null,
    facilities: {
      arcade: null,
      parking: null,
      rest_area: null,
      luggage_storage: null,
      foreigner_information_center: null,
    },
    error: null,
  };
}

function buildApiErrorMarketContext(message: string): MarketContext {
  return {
    ...buildNotFoundMarketContext(),
    status: "api_error",
    error: message,
  };
}

function normalizeMarketRecord(record: JsonRecord): MarketContext {
  return {
    found: true,
    status: "found",
    source: SOURCE_NAME,
    market_code: getString(record, ["시장코드", "시장 코드", "market_code"]),
    market_name: getString(record, ["시장명", "시장 명", "market_name"]),
    market_type: getString(record, ["시장유형", "시장 유형", "market_type"]),
    province: getString(record, ["시도", "시/도", "province"]),
    district: getString(record, ["시군구", "시/군/구", "district"]),
    road_address: getString(record, ["도로명주소", "도로명 주소", "road_address"]),
    facilities: {
      arcade: normalizeBoolean(
        record["아케이드 보유 여부"] ?? record["아케이드보유여부"] ?? record["arcade"],
      ),
      parking: normalizeBoolean(
        record["시장전용 고객주차장_보유여부"] ??
          record["시장전용고객주차장_보유여부"] ??
          record["parking"],
      ),
      rest_area: normalizeBoolean(
        record["고객휴게실_보유여부"] ??
          record["고객휴게실보유여부"] ??
          record["rest_area"],
      ),
      luggage_storage: normalizeBoolean(
        record["물품보관함_보유여부"] ??
          record["물품보관함보유여부"] ??
          record["luggage_storage"],
      ),
      foreigner_information_center: normalizeBoolean(
        record["외국인 안내센터_보유여부"] ??
          record["외국인안내센터_보유여부"] ??
          record["foreigner_information_center"],
      ),
    },
    error: null,
  };
}

function getPageCacheKey(page: number, perPage: number) {
  return `${page}:${perPage}`;
}

function getLookupCacheKey(marketName: string) {
  return normalizeMarketName(marketName);
}

async function fetchTraditionalMarketPage(
  page: number,
  perPage = DEFAULT_PER_PAGE,
  deps?: TraditionalMarketClientDeps,
): Promise<TraditionalMarketPageResult> {
  const cacheKey = getPageCacheKey(page, perPage);
  const cached = pageCache.get(cacheKey);
  const now = getNow(deps);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const serviceKey = deps?.serviceKey ?? getDataGoKrServiceKey();

  if (!serviceKey) {
    throw new Error("Traditional market API is not configured");
  }

  const url = new URL(`${BASE_URL}${DATASET_PATH}`);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("returnType", "JSON");
  url.searchParams.set("page", String(page));
  url.searchParams.set("perPage", String(perPage));

  const fetchImpl = deps?.fetchImpl ?? fetchWithTimeout;
  const response = await fetchImpl(url, {
    headers: {
      Authorization: serviceKey,
    },
    timeoutMs: 8_000,
  });

  if (!response.ok) {
    throw new Error(`Traditional market API request failed with status ${response.status}`);
  }

  const json = (await response.json()) as TraditionalMarketApiResponse;

  if (!json || !Array.isArray(json.data)) {
    throw new Error("Traditional market API returned an invalid response");
  }

  const result = {
    data: json.data,
    currentCount:
      typeof json.currentCount === "number" ? json.currentCount : json.data.length,
    page: typeof json.page === "number" ? json.page : page,
    perPage: typeof json.perPage === "number" ? json.perPage : perPage,
    totalCount: typeof json.totalCount === "number" ? json.totalCount : null,
  };

  pageCache.set(cacheKey, {
    expiresAt: now + CACHE_TTL_MS,
    value: result,
  });

  return result;
}

function matchesMarketName(inputName: string, candidateName: string | null) {
  if (!candidateName) {
    return false;
  }

  return normalizeMarketName(inputName) === normalizeMarketName(candidateName);
}

export async function getMarketContext(
  marketName: string | null | undefined,
  deps?: TraditionalMarketClientDeps,
): Promise<MarketContext> {
  if (!marketName || marketName.trim().length === 0) {
    return buildNotFoundMarketContext();
  }

  const cacheKey = getLookupCacheKey(marketName);
  const cached = lookupCache.get(cacheKey);
  const now = getNow(deps);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  try {
    let page = 1;
    const perPage = DEFAULT_PER_PAGE;

    while (true) {
      const result = await fetchTraditionalMarketPage(page, perPage, deps);
      const matchedRecord = result.data.find((record) =>
        matchesMarketName(
          marketName,
          getString(record, ["시장명", "시장 명", "market_name"]),
        ),
      );

      if (matchedRecord) {
        const context = normalizeMarketRecord(matchedRecord);
        lookupCache.set(cacheKey, {
          expiresAt: now + CACHE_TTL_MS,
          value: context,
        });
        return context;
      }

      if (result.currentCount < perPage) {
        break;
      }

      if (result.totalCount !== null && page * perPage >= result.totalCount) {
        break;
      }

      page += 1;
    }

    const notFound = buildNotFoundMarketContext();
    lookupCache.set(cacheKey, {
      expiresAt: now + CACHE_TTL_MS,
      value: notFound,
    });
    return notFound;
  } catch (error) {
    return buildApiErrorMarketContext(
      error instanceof Error ? error.message : "Traditional market API error",
    );
  }
}

export function clearTraditionalMarketCache() {
  pageCache.clear();
  lookupCache.clear();
}
