import { getTourApiEnv } from "@/lib/env";
import { calculateHaversineDistanceKm } from "@/lib/geo/distance";
import { fetchWithTimeout } from "@/lib/http";

import type { MarketContext } from "./traditional-market";

const SOURCE_NAME = "한국관광공사_국문 관광정보 서비스_GW";
const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_NUM_ROWS = 100;

type JsonRecord = Record<string, unknown>;

type TourFestivalClientDeps = {
  fetchImpl?: typeof fetchWithTimeout;
  serviceKey?: string | null;
  now?: () => Date;
};

type FestivalSearchItem = {
  contentid?: string;
  contenttypeid?: string;
  title?: string;
  addr1?: string;
  addr2?: string;
  eventstartdate?: string;
  eventenddate?: string;
  mapx?: string;
  mapy?: string;
  tel?: string;
  firstimage?: string;
  firstimage2?: string;
  lDongRegnCd?: string;
  lDongSignguCd?: string;
};

type TourApiEnvelope<TItem = JsonRecord> = {
  response?: {
    header?: {
      resultCode?: string;
      resultMsg?: string;
    };
    body?: {
      numOfRows?: number;
      pageNo?: number;
      totalCount?: number;
      items?: {
        item?: TItem | TItem[];
      };
    };
  };
};

type LdongCodeItem = JsonRecord & {
  lDongRegnCd?: string;
  lDongRegnNm?: string;
  lDongSignguCd?: string;
  lDongSignguNm?: string;
  code?: string;
  name?: string;
};

type FestivalCandidate = {
  contentId: string;
  title: string;
  eventStartDate: string;
  eventEndDate: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  regionMatch: boolean;
  distanceKm: number | null;
  ongoing: boolean;
};

export type FestivalContext = {
  found: boolean;
  source: string;
  content_id?: string;
  title?: string;
  event_start_date?: string;
  event_end_date?: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  distance_km?: number | null;
  region_match?: boolean;
  verified?: boolean;
  reason?: "no_relevant_festival" | "festival_api_unavailable";
};

type FestivalSearchResult = {
  items: FestivalSearchItem[];
  pageNo: number;
  numOfRows: number;
  totalCount: number;
};

type LegalDistrictCodes = {
  lDongRegnCd: string | null;
  lDongSignguCd: string | null;
};

const festivalCache = new Map<string, { expiresAt: number; value: FestivalContext }>();

function normalizeWhitespace(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function normalizeRegionName(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return normalizeWhitespace(value)
    .replace(/(특별자치시|특별자치도|특별시|광역시|자치시|자치도)$/g, "")
    .replace(/(시|군|구)$/g, "")
    .toLowerCase();
}

function parseNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatIsoDate(value: string) {
  if (value.length !== 8) {
    return value;
  }

  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getCacheKey(
  marketContext: MarketContext,
  startDate: string,
  endDate: string,
) {
  return `festival:${marketContext.province ?? ""}:${marketContext.district ?? ""}:${startDate}:${endDate}`;
}

function getNow(deps?: TourFestivalClientDeps) {
  return deps?.now ? deps.now() : new Date();
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

async function readTourApiJson<TItem = JsonRecord>(
  path: string,
  params: Record<string, string | undefined>,
  deps?: TourFestivalClientDeps,
) {
  const config = getTourApiEnv();
  const serviceKey = deps?.serviceKey ?? config.serviceKey;

  if (!serviceKey) {
    throw new Error("Tour API is not configured");
  }

  const url = new URL(`${config.baseUrl}${path}`);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("MobileOS", config.mobileOs);
  url.searchParams.set("MobileApp", config.mobileApp);
  url.searchParams.set("_type", "json");

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.length > 0) {
      url.searchParams.set(key, value);
    }
  }

  const fetchImpl = deps?.fetchImpl ?? fetchWithTimeout;
  const response = await fetchImpl(url, {
    timeoutMs: 8_000,
  });

  if (!response.ok) {
    throw new Error(`Tour API request failed with status ${response.status}`);
  }

  const json = (await response.json()) as TourApiEnvelope<TItem>;
  const resultCode = json.response?.header?.resultCode;
  const resultMsg = json.response?.header?.resultMsg;

  if (resultCode && resultCode !== "0000") {
    throw new Error(resultMsg || `Tour API error: ${resultCode}`);
  }

  return json;
}

async function fetchFestivalPage(
  pageNo: number,
  startDate: string,
  endDate: string,
  legalDistrictCodes: LegalDistrictCodes | null,
  deps?: TourFestivalClientDeps,
): Promise<FestivalSearchResult> {
  const json = await readTourApiJson<FestivalSearchItem>(
    "/searchFestival2",
    {
      pageNo: String(pageNo),
      numOfRows: String(DEFAULT_NUM_ROWS),
      arrange: "A",
      eventStartDate: startDate,
      eventEndDate: endDate,
      lDongRegnCd: legalDistrictCodes?.lDongRegnCd ?? undefined,
      lDongSignguCd: legalDistrictCodes?.lDongSignguCd ?? undefined,
    },
    deps,
  );

  const body = json.response?.body;
  return {
    items: toArray(body?.items?.item),
    pageNo: body?.pageNo ?? pageNo,
    numOfRows: body?.numOfRows ?? DEFAULT_NUM_ROWS,
    totalCount: body?.totalCount ?? 0,
  };
}

async function fetchDetailCommon(contentId: string, deps?: TourFestivalClientDeps) {
  const json = await readTourApiJson<JsonRecord>(
    "/detailCommon2",
    {
      contentId,
    },
    deps,
  );

  return toArray(json.response?.body?.items?.item)[0] ?? null;
}

async function fetchLdongPage(
  pageNo: number,
  params: Record<string, string | undefined>,
  deps?: TourFestivalClientDeps,
) {
  const json = await readTourApiJson<LdongCodeItem>(
    "/ldongCode2",
    {
      pageNo: String(pageNo),
      numOfRows: String(DEFAULT_NUM_ROWS),
      lDongListYn: "Y",
      ...params,
    },
    deps,
  );

  const body = json.response?.body;
  return {
    items: toArray(body?.items?.item),
    pageNo: body?.pageNo ?? pageNo,
    numOfRows: body?.numOfRows ?? DEFAULT_NUM_ROWS,
    totalCount: body?.totalCount ?? 0,
  };
}

async function resolveLegalDistrictCodes(
  marketContext: MarketContext,
  deps?: TourFestivalClientDeps,
): Promise<LegalDistrictCodes | null> {
  if (!marketContext.province) {
    return null;
  }

  try {
    const provincePage = await fetchLdongPage(1, {}, deps);
    const matchedProvince = provincePage.items.find((item) => {
      const provinceName =
        (typeof item.lDongRegnNm === "string" && item.lDongRegnNm) ||
        (typeof item.name === "string" && item.name) ||
        "";

      return (
        normalizeRegionName(provinceName) ===
        normalizeRegionName(marketContext.province)
      );
    });

    if (!matchedProvince) {
      return null;
    }

    const lDongRegnCd =
      typeof matchedProvince.lDongRegnCd === "string"
        ? matchedProvince.lDongRegnCd
        : typeof matchedProvince.code === "string"
          ? matchedProvince.code
          : null;

    if (!lDongRegnCd || !marketContext.district) {
      return {
        lDongRegnCd,
        lDongSignguCd: null,
      };
    }

    const districtPage = await fetchLdongPage(
      1,
      {
        lDongRegnCd,
      },
      deps,
    );

    const matchedDistrict = districtPage.items.find((item) => {
      const districtName =
        (typeof item.lDongSignguNm === "string" && item.lDongSignguNm) ||
        (typeof item.name === "string" && item.name) ||
        "";

      return (
        normalizeRegionName(districtName) ===
        normalizeRegionName(marketContext.district)
      );
    });

    return {
      lDongRegnCd,
      lDongSignguCd:
        typeof matchedDistrict?.lDongSignguCd === "string"
          ? matchedDistrict.lDongSignguCd
          : null,
    };
  } catch {
    return null;
  }
}

function getAddressText(item: {
  addr1?: unknown;
  addr2?: unknown;
  road_address?: unknown;
}) {
  const addr1 = typeof item.addr1 === "string" ? item.addr1.trim() : "";
  const addr2 = typeof item.addr2 === "string" ? item.addr2.trim() : "";
  const roadAddress =
    typeof item.road_address === "string" ? item.road_address.trim() : "";

  return [addr1 || roadAddress, addr2].filter(Boolean).join(" ").trim() || null;
}

function matchesMarketRegion(marketContext: MarketContext, address: string | null) {
  if (!marketContext.province || !marketContext.district || !address) {
    return false;
  }

  const normalizedAddress = normalizeWhitespace(address).toLowerCase();

  return (
    normalizedAddress.includes(normalizeRegionName(marketContext.province)) &&
    normalizedAddress.includes(normalizeRegionName(marketContext.district))
  );
}

function normalizeFestivalCandidate(
  item: FestivalSearchItem,
  marketContext: MarketContext,
  now: Date,
  legalDistrictCodes: LegalDistrictCodes | null,
) {
  const startDate = typeof item.eventstartdate === "string" ? item.eventstartdate : "";
  const endDate = typeof item.eventenddate === "string" ? item.eventenddate : "";
  const contentId = typeof item.contentid === "string" ? item.contentid : null;
  const title = typeof item.title === "string" ? item.title.trim() : null;

  if (!contentId || !title || !startDate || !endDate) {
    return null;
  }

  const address = getAddressText(item);
  const latitude = parseNumber(item.mapy);
  const longitude = parseNumber(item.mapx);
  const regionMatch =
    (Boolean(legalDistrictCodes?.lDongRegnCd) &&
      item.lDongRegnCd === legalDistrictCodes?.lDongRegnCd &&
      (!legalDistrictCodes?.lDongSignguCd ||
        item.lDongSignguCd === legalDistrictCodes.lDongSignguCd)) ||
    matchesMarketRegion(marketContext, address);
  const today = formatDate(now);
  const ongoing = today >= startDate && today <= endDate;

  return {
    contentId,
    title,
    eventStartDate: startDate,
    eventEndDate: endDate,
    address,
    latitude,
    longitude,
    regionMatch,
    distanceKm: null,
    ongoing,
  } satisfies FestivalCandidate;
}

async function enrichFestivalCandidate(
  candidate: FestivalCandidate,
  deps?: TourFestivalClientDeps,
) {
  if (
    candidate.address &&
    candidate.latitude !== null &&
    candidate.longitude !== null
  ) {
    return candidate;
  }

  try {
    const detail = await fetchDetailCommon(candidate.contentId, deps);
    if (!detail || typeof detail !== "object") {
      return candidate;
    }

    return {
      ...candidate,
      address: candidate.address ?? getAddressText(detail),
      latitude: candidate.latitude ?? parseNumber(detail.mapy),
      longitude: candidate.longitude ?? parseNumber(detail.mapx),
    };
  } catch {
    return candidate;
  }
}

function resolveMarketCoordinates(marketContext: MarketContext) {
  if (
    typeof marketContext.latitude === "number" &&
    Number.isFinite(marketContext.latitude) &&
    typeof marketContext.longitude === "number" &&
    Number.isFinite(marketContext.longitude)
  ) {
    return {
      latitude: marketContext.latitude,
      longitude: marketContext.longitude,
    };
  }

  return null;
}

function withDistance(
  candidate: FestivalCandidate,
  marketContext: MarketContext,
) {
  const marketCoordinates = resolveMarketCoordinates(marketContext);

  if (
    !marketCoordinates ||
    candidate.latitude === null ||
    candidate.longitude === null
  ) {
    return candidate;
  }

  return {
    ...candidate,
    distanceKm: calculateHaversineDistanceKm(marketCoordinates, {
      latitude: candidate.latitude,
      longitude: candidate.longitude,
    }),
  };
}

function compareFestivalCandidates(left: FestivalCandidate, right: FestivalCandidate) {
  if (left.ongoing !== right.ongoing) {
    return left.ongoing ? -1 : 1;
  }

  const leftDistance = left.distanceKm ?? Number.POSITIVE_INFINITY;
  const rightDistance = right.distanceKm ?? Number.POSITIVE_INFINITY;

  if (leftDistance !== rightDistance) {
    return leftDistance - rightDistance;
  }

  return left.eventStartDate.localeCompare(right.eventStartDate);
}

function buildFestivalContext(candidate: FestivalCandidate): FestivalContext {
  return {
    found: true,
    source: SOURCE_NAME,
    content_id: candidate.contentId,
    title: candidate.title,
    event_start_date: formatIsoDate(candidate.eventStartDate),
    event_end_date: formatIsoDate(candidate.eventEndDate),
    address: candidate.address,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    distance_km:
      candidate.distanceKm !== null
        ? Number(candidate.distanceKm.toFixed(1))
        : null,
    region_match: candidate.regionMatch,
    verified: true,
  };
}

function buildNoFestivalContext(): FestivalContext {
  return {
    found: false,
    source: SOURCE_NAME,
    reason: "no_relevant_festival",
  };
}

function buildFestivalApiUnavailableContext(): FestivalContext {
  return {
    found: false,
    source: SOURCE_NAME,
    reason: "festival_api_unavailable",
  };
}

export async function getFestivalContext(
  marketContext: MarketContext,
  deps?: TourFestivalClientDeps,
): Promise<FestivalContext> {
  if (!marketContext.found || !marketContext.province || !marketContext.district) {
    return buildNoFestivalContext();
  }

  const config = getTourApiEnv();
  const now = getNow(deps);
  const startDate = formatDate(now);
  const endDate = formatDate(addDays(now, Math.max(0, config.lookaheadDays)));
  const cacheKey = getCacheKey(marketContext, startDate, endDate);
  const nowMs = now.getTime();
  const cached = festivalCache.get(cacheKey);

  if (cached && cached.expiresAt > nowMs) {
    return cached.value;
  }

  try {
    const legalDistrictCodes = await resolveLegalDistrictCodes(marketContext, deps);
    let pageNo = 1;
    const candidates: FestivalCandidate[] = [];

    while (true) {
      const page = await fetchFestivalPage(
        pageNo,
        startDate,
        endDate,
        legalDistrictCodes,
        deps,
      );

      for (const item of page.items) {
        const normalized = normalizeFestivalCandidate(
          item,
          marketContext,
          now,
          legalDistrictCodes,
        );
        if (!normalized) {
          continue;
        }

        const enriched = await enrichFestivalCandidate(normalized, deps);
        const withDistanceCandidate = withDistance(enriched, marketContext);

        if (!withDistanceCandidate.regionMatch) {
          continue;
        }

        if (
          withDistanceCandidate.distanceKm !== null &&
          withDistanceCandidate.distanceKm > config.maxDistanceKm
        ) {
          continue;
        }

        candidates.push(withDistanceCandidate);
      }

      if (page.pageNo * page.numOfRows >= page.totalCount || page.items.length === 0) {
        break;
      }

      pageNo += 1;
    }

    const best = [...candidates].sort(compareFestivalCandidates)[0];
    const value = best ? buildFestivalContext(best) : buildNoFestivalContext();
    festivalCache.set(cacheKey, {
      expiresAt: nowMs + CACHE_TTL_MS,
      value,
    });

    return value;
  } catch {
    const value = buildFestivalApiUnavailableContext();
    festivalCache.set(cacheKey, {
      expiresAt: nowMs + CACHE_TTL_MS,
      value,
    });

    return value;
  }
}

export function clearFestivalCache() {
  festivalCache.clear();
}
