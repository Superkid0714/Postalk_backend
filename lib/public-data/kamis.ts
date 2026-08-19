import { getKamisApiEnv } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http";

import type { MarketContext } from "./traditional-market";

const SOURCE_NAME = "한국농수산식품유통공사_지역별 품목별 도소매 가격정보";
const RETAIL_SE_CD = "01";
const DEFAULT_NUM_ROWS = 100;
const CACHE_TTL_MS = 10 * 60 * 1000;

type KamisClientDeps = {
  fetchImpl?: typeof fetchWithTimeout;
  serviceKey?: string | null;
  now?: () => Date;
};

type KamisApiEnvelope = {
  response?: {
    header?: {
      resultCode?: string;
      resultMsg?: string;
    };
    body?: {
      totalCount?: number;
      dataType?: string;
      items?: {
        item?: KamisItem | KamisItem[];
      };
      pageNo?: number;
      numOfRows?: number;
    };
  };
};

type KamisItem = {
  exmn_ymd?: string;
  se_cd?: string;
  se_nm?: string;
  ctgry_cd?: string;
  ctgry_nm?: string;
  item_cd?: string;
  item_nm?: string;
  vrty_cd?: string;
  vrty_nm?: string;
  grd_cd?: string;
  grd_nm?: string;
  sgg_cd?: string;
  sgg_nm?: string;
  unit?: string;
  unit_sz?: string;
  exmn_dd_min_prc?: string;
  exmn_dd_cnvs_min_prc?: string;
  exmn_dd_avg_prc?: string;
  exmn_dd_cnvs_avg_prc?: string;
  exmn_dd_max_prc?: string;
  exmn_dd_cnvs_max_prc?: string;
};

type KamisProductMatch = {
  matched: boolean;
  merchantProduct: string;
  normalizedProduct: string | null;
  itemCode: string | null;
  itemName: string | null;
  categoryCode: string | null;
  reason?: "product_not_supported" | "match_uncertain";
};

type KamisRegionMatch = {
  matched: boolean;
  regionCode: string | null;
  regionName: string | null;
  regionPrecision: "province" | "district" | null;
  reason?: "region_not_supported";
};

type KamisPriceTrend = "rising" | "falling" | "stable" | "unknown";

type KamisSelectedContext = {
  kamis: boolean;
  reason: string;
};

export type KamisContext = {
  used: boolean;
  source: string;
  matched: boolean;
  merchant_product: string;
  matched_item: string | null;
  matched_item_code: string | null;
  region: string | null;
  region_code: string | null;
  price_type: "retail" | "wholesale" | null;
  period_start: string | null;
  period_end: string | null;
  unit: string | null;
  unit_size: string | null;
  grade: string | null;
  variety: string | null;
  latest_price: number | null;
  average_price: number | null;
  latest_price_date: string | null;
  price_trend: KamisPriceTrend | null;
  unit_match: boolean;
  region_match: boolean;
  price_comparison_allowed: boolean;
  verified: boolean;
  selected_for_prompt: boolean;
  selection_reason: string | null;
  reason?:
    | "product_not_supported"
    | "match_uncertain"
    | "region_not_supported"
    | "no_recent_price_data"
    | "kamis_api_unavailable";
};

type KamisQueryResult = {
  items: KamisItem[];
  pageNo: number;
  numOfRows: number;
  totalCount: number;
};

const KAMIS_PRODUCT_CATALOG = [
  { itemCode: "411", itemName: "사과", categoryCode: "400", aliases: ["사과", "빨간사과", "홍로사과", "부사사과", "사과1kg", "사과 1kg"] },
  { itemCode: "412", itemName: "배", categoryCode: "400", aliases: ["배", "신고배", "배1kg", "배 1kg"] },
  { itemCode: "211", itemName: "배추", categoryCode: "200", aliases: ["배추", "알배추", "김장배추"] },
  { itemCode: "231", itemName: "무", categoryCode: "200", aliases: ["무", "무우"] },
  { itemCode: "226", itemName: "딸기", categoryCode: "200", aliases: ["딸기", "생딸기"] },
  { itemCode: "243", itemName: "붉은고추", categoryCode: "200", aliases: ["붉은고추", "빨간고추", "고추"] },
  { itemCode: "242", itemName: "풋고추", categoryCode: "200", aliases: ["풋고추", "청고추"] },
  { itemCode: "225", itemName: "토마토", categoryCode: "200", aliases: ["토마토"] },
  { itemCode: "422", itemName: "방울토마토", categoryCode: "400", aliases: ["방울토마토", "방울 토마토", "방울토마토한팩", "방울토마토 한팩"] },
  { itemCode: "245", itemName: "양파", categoryCode: "200", aliases: ["양파"] },
  { itemCode: "246", itemName: "파", categoryCode: "200", aliases: ["파", "대파", "쪽파"] },
  { itemCode: "152", itemName: "감자", categoryCode: "100", aliases: ["감자"] },
  { itemCode: "151", itemName: "고구마", categoryCode: "100", aliases: ["고구마"] },
].map((item) => ({
  ...item,
  normalizedAliases: item.aliases.map(normalizeProductKey),
}));

const KAMIS_REGION_CODES = [
  { code: "1101", aliases: ["서울", "서울특별시"] },
  { code: "2100", aliases: ["부산", "부산광역시"] },
  { code: "2200", aliases: ["대구", "대구광역시"] },
  { code: "2300", aliases: ["인천", "인천광역시"] },
  { code: "2401", aliases: ["광주", "광주광역시"] },
  { code: "2501", aliases: ["대전", "대전광역시"] },
  { code: "2601", aliases: ["울산", "울산광역시"] },
  { code: "2701", aliases: ["세종", "세종특별자치시"] },
  { code: "3100", aliases: ["경기", "경기도"] },
  { code: "3111", aliases: ["수원", "수원시"] },
  { code: "3112", aliases: ["성남", "성남시"] },
  { code: "3113", aliases: ["의정부", "의정부시"] },
  { code: "3138", aliases: ["고양", "고양시"] },
  { code: "3145", aliases: ["용인", "용인시"] },
  { code: "3201", aliases: ["강원", "강원도", "강원특별자치도"] },
  { code: "3211", aliases: ["춘천", "춘천시"] },
  { code: "3214", aliases: ["강릉", "강릉시"] },
  { code: "3300", aliases: ["충북", "충청북도"] },
  { code: "3311", aliases: ["청주", "청주시"] },
  { code: "3312", aliases: ["충주", "충주시"] },
  { code: "3400", aliases: ["충남", "충청남도"] },
  { code: "3411", aliases: ["천안", "천안시"] },
  { code: "3500", aliases: ["전북", "전라북도", "전북특별자치도"] },
  { code: "3511", aliases: ["전주", "전주시"] },
  { code: "3512", aliases: ["군산", "군산시"] },
  { code: "3600", aliases: ["전남", "전라남도"] },
  { code: "3611", aliases: ["목포", "목포시"] },
  { code: "3613", aliases: ["순천", "순천시"] },
  { code: "3700", aliases: ["경북", "경상북도"] },
  { code: "3711", aliases: ["포항", "포항시"] },
  { code: "3714", aliases: ["안동", "안동시"] },
  { code: "3800", aliases: ["경남", "경상남도"] },
  { code: "3811", aliases: ["마산", "마산시"] },
  { code: "3814", aliases: ["창원", "창원시"] },
  { code: "3818", aliases: ["김해", "김해시"] },
  { code: "3911", aliases: ["제주", "제주특별자치도"] },
].map((item) => ({
  code: item.code,
  aliases: item.aliases,
  normalizedAliases: item.aliases.map(normalizeRegionKey),
}));

const kamisCache = new Map<string, { expiresAt: number; value: KamisContext }>();

function normalizeWhitespace(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function normalizeProductKey(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[()\-_/.,·]/g, "")
    .replace(/\s+/g, "")
    .replace(/(한팩|1kg|2kg|3kg|500g|10kg|한봉지|봉지|팩|박스|세트|국산|수입)$/g, "");
}

function normalizeRegionKey(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/(특별자치시|특별자치도|특별시|광역시|도)$/g, "")
    .replace(/시$/g, "");
}

function parseNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCompactDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatIsoDate(value: string | null) {
  if (!value || value.length !== 8) {
    return value;
  }

  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function getNow(deps?: KamisClientDeps) {
  return deps?.now ? deps.now() : new Date();
}

function getCacheKey(
  regionCode: string,
  itemCode: string,
  periodStart: string,
  periodEnd: string,
) {
  return `kamis:retail:${regionCode}:${itemCode}:${periodStart}:${periodEnd}`;
}

function buildUnusedKamisContext(
  merchantProduct: string,
  reason: KamisContext["reason"],
): KamisContext {
  return {
    used: false,
    source: SOURCE_NAME,
    matched: false,
    merchant_product: merchantProduct,
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
    selection_reason: null,
    reason,
  };
}

function buildApiUnavailableKamisContext(
  merchantProduct: string,
  match: KamisProductMatch,
  region: KamisRegionMatch,
  periodStart: string,
  periodEnd: string,
): KamisContext {
  return {
    used: false,
    source: SOURCE_NAME,
    matched: match.matched,
    merchant_product: merchantProduct,
    matched_item: match.itemName,
    matched_item_code: match.itemCode,
    region: region.regionName,
    region_code: region.regionCode,
    price_type: "retail",
    period_start: formatIsoDate(periodStart),
    period_end: formatIsoDate(periodEnd),
    unit: null,
    unit_size: null,
    grade: null,
    variety: null,
    latest_price: null,
    average_price: null,
    latest_price_date: null,
    price_trend: null,
    unit_match: false,
    region_match: region.matched,
    price_comparison_allowed: false,
    verified: false,
    selected_for_prompt: false,
    selection_reason: null,
    reason: "kamis_api_unavailable",
  };
}

function matchMerchantProduct(merchantProduct: string): KamisProductMatch {
  const normalized = normalizeProductKey(merchantProduct);

  if (!normalized) {
    return {
      matched: false,
      merchantProduct,
      normalizedProduct: null,
      itemCode: null,
      itemName: null,
      categoryCode: null,
      reason: "match_uncertain",
    };
  }

  const direct = KAMIS_PRODUCT_CATALOG.find((candidate) =>
    candidate.normalizedAliases.includes(normalized),
  );

  if (direct) {
    return {
      matched: true,
      merchantProduct,
      normalizedProduct: normalized,
      itemCode: direct.itemCode,
      itemName: direct.itemName,
      categoryCode: direct.categoryCode,
    };
  }

  const contains = KAMIS_PRODUCT_CATALOG.find((candidate) =>
    candidate.normalizedAliases.some(
      (alias) => normalized.includes(alias) || alias.includes(normalized),
    ),
  );

  if (contains) {
    return {
      matched: true,
      merchantProduct,
      normalizedProduct: normalized,
      itemCode: contains.itemCode,
      itemName: contains.itemName,
      categoryCode: contains.categoryCode,
    };
  }

  return {
    matched: false,
    merchantProduct,
    normalizedProduct: normalized,
    itemCode: null,
    itemName: null,
    categoryCode: null,
    reason: "product_not_supported",
  };
}

function resolveKamisRegion(marketContext: MarketContext): KamisRegionMatch {
  const province = marketContext.province ? normalizeRegionKey(marketContext.province) : null;
  const district = marketContext.district ? normalizeRegionKey(marketContext.district) : null;

  if (district) {
    const districtMatch = KAMIS_REGION_CODES.find((entry) =>
      entry.normalizedAliases.includes(district),
    );
    if (districtMatch) {
      const alias = districtMatch.aliases[0];
      return {
        matched: true,
        regionCode: districtMatch.code,
        regionName: alias,
        regionPrecision: "district",
      };
    }
  }

  if (province) {
    const provinceMatch = KAMIS_REGION_CODES.find((entry) =>
      entry.normalizedAliases.includes(province),
    );
    if (provinceMatch) {
      const alias = provinceMatch.aliases[0];
      return {
        matched: true,
        regionCode: provinceMatch.code,
        regionName: alias,
        regionPrecision: "province",
      };
    }
  }

  return {
    matched: false,
    regionCode: null,
    regionName: null,
    regionPrecision: null,
    reason: "region_not_supported",
  };
}

function detectMerchantUnitHint(merchantProduct: string) {
  const source = normalizeWhitespace(merchantProduct).toLowerCase();

  if (/kg|킬로/.test(source)) {
    return "kg";
  }
  if (/g|그램/.test(source)) {
    return "g";
  }
  if (/개/.test(source)) {
    return "개";
  }
  if (/팩/.test(source)) {
    return "팩";
  }
  if (/봉지/.test(source)) {
    return "봉지";
  }

  return null;
}

function normalizeKamisUnit(unit: string | null, unitSize: string | null) {
  const source = `${unit ?? ""} ${unitSize ?? ""}`.toLowerCase();
  if (source.includes("kg")) {
    return "kg";
  }
  if (source.includes("g")) {
    return "g";
  }
  if (source.includes("개")) {
    return "개";
  }
  if (source.includes("팩")) {
    return "팩";
  }
  if (source.includes("봉지")) {
    return "봉지";
  }
  return null;
}

function buildSelectable() {
  return [
    "exmn_ymd",
    "se_cd",
    "se_nm",
    "ctgry_cd",
    "ctgry_nm",
    "item_cd",
    "item_nm",
    "vrty_cd",
    "vrty_nm",
    "grd_cd",
    "grd_nm",
    "sgg_cd",
    "sgg_nm",
    "unit",
    "unit_sz",
    "exmn_dd_avg_prc",
    "exmn_dd_cnvs_avg_prc",
    "exmn_dd_min_prc",
    "exmn_dd_cnvs_min_prc",
    "exmn_dd_max_prc",
    "exmn_dd_cnvs_max_prc",
  ].join(",");
}

async function readKamisApiJson(
  params: Record<string, string>,
  deps?: KamisClientDeps,
) {
  const config = getKamisApiEnv();
  const serviceKey = deps?.serviceKey ?? config.serviceKey;

  if (!serviceKey) {
    throw new Error("KAMIS API is not configured");
  }

  const url = new URL(`${config.baseUrl}/price`);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("returnType", "JSON");

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const fetchImpl = deps?.fetchImpl ?? fetchWithTimeout;
  const response = await fetchImpl(url, {
    timeoutMs: 8_000,
  });

  if (!response.ok) {
    throw new Error(`KAMIS API request failed with status ${response.status}`);
  }

  const json = (await response.json()) as KamisApiEnvelope;
  const resultCode = json.response?.header?.resultCode;
  const resultMsg = json.response?.header?.resultMsg;

  if (resultCode && resultCode !== "00" && resultCode !== "0000") {
    throw new Error(resultMsg || `KAMIS API error: ${resultCode}`);
  }

  return json;
}

async function fetchKamisPage(
  regionCode: string,
  itemCode: string,
  periodStart: string,
  periodEnd: string,
  pageNo: number,
  deps?: KamisClientDeps,
): Promise<KamisQueryResult> {
  const json = await readKamisApiJson(
    {
      pageNo: String(pageNo),
      numOfRows: String(DEFAULT_NUM_ROWS),
      "cond[exmn_ymd::GTE]": periodStart,
      "cond[exmn_ymd::LTE]": periodEnd,
      "cond[se_cd::EQ]": RETAIL_SE_CD,
      "cond[item_cd::EQ]": itemCode,
      "cond[sgg_cd::EQ]": regionCode,
      selectable: buildSelectable(),
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

function compareKamisItems(left: KamisItem, right: KamisItem) {
  return (right.exmn_ymd ?? "").localeCompare(left.exmn_ymd ?? "");
}

function computeAverage(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function computeTrend(items: KamisItem[]) {
  if (items.length < 2) {
    return "unknown" as KamisPriceTrend;
  }

  const sorted = [...items].sort((left, right) =>
    (left.exmn_ymd ?? "").localeCompare(right.exmn_ymd ?? ""),
  );
  const first = parseNumber(sorted[0]?.exmn_dd_avg_prc);
  const last = parseNumber(sorted[sorted.length - 1]?.exmn_dd_avg_prc);

  if (first === null || last === null || first === 0) {
    return "unknown";
  }

  const deltaRatio = (last - first) / first;
  if (Math.abs(deltaRatio) < 0.03) {
    return "stable";
  }
  if (deltaRatio > 0) {
    return "rising";
  }
  return "falling";
}

function buildSelectedContext(kamisContext: KamisContext): KamisSelectedContext {
  if (
    kamisContext.used &&
    kamisContext.matched &&
    kamisContext.verified &&
    kamisContext.region_match
  ) {
    return {
      kamis: true,
      reason:
        "사용자 상품이 KAMIS 조회 가능 품목이며 최근 지역 소매가격 데이터가 확인됨",
    };
  }

  if (kamisContext.reason === "product_not_supported") {
    return {
      kamis: false,
      reason: "사용자 상품이 KAMIS 지원 품목이 아니어서 조회하지 않음",
    };
  }

  if (kamisContext.reason === "no_recent_price_data") {
    return {
      kamis: false,
      reason: "최근 조회 기간 내 지역 가격 데이터가 없어 사용하지 않음",
    };
  }

  return {
    kamis: false,
    reason: "광고 전략에 활용할 만한 KAMIS 가격 컨텍스트가 충분하지 않음",
  };
}

function buildKamisContext(
  merchantProduct: string,
  match: KamisProductMatch,
  region: KamisRegionMatch,
  periodStart: string,
  periodEnd: string,
  items: KamisItem[],
): KamisContext {
  if (items.length === 0) {
    return {
      used: false,
      source: SOURCE_NAME,
      matched: true,
      merchant_product: merchantProduct,
      matched_item: match.itemName,
      matched_item_code: match.itemCode,
      region: region.regionName,
      region_code: region.regionCode,
      price_type: "retail",
      period_start: formatIsoDate(periodStart),
      period_end: formatIsoDate(periodEnd),
      unit: null,
      unit_size: null,
      grade: null,
      variety: null,
      latest_price: null,
      average_price: null,
      latest_price_date: null,
      price_trend: "unknown",
      unit_match: false,
      region_match: region.matched,
      price_comparison_allowed: false,
      verified: false,
      selected_for_prompt: false,
      selection_reason: null,
      reason: "no_recent_price_data",
    };
  }

  const retailItems = items.filter((item) => item.se_cd === RETAIL_SE_CD);
  const sortedItems = [...retailItems].sort(compareKamisItems);
  const latestItem = sortedItems[0] ?? items[0];
  const averageValues = sortedItems
    .map((item) => parseNumber(item.exmn_dd_avg_prc))
    .filter((value): value is number => value !== null);
  const merchantUnitHint = detectMerchantUnitHint(merchantProduct);
  const unit = latestItem.unit ?? null;
  const unitSize = latestItem.unit_sz ?? null;
  const normalizedKamisUnit = normalizeKamisUnit(unit, unitSize);
  const unitMatch =
    merchantUnitHint !== null && normalizedKamisUnit !== null
      ? merchantUnitHint === normalizedKamisUnit
      : false;

  const selected = buildSelectedContext({
    used: true,
    source: SOURCE_NAME,
    matched: true,
    merchant_product: merchantProduct,
    matched_item: match.itemName,
    matched_item_code: match.itemCode,
    region: region.regionName,
    region_code: region.regionCode,
    price_type: "retail",
    period_start: formatIsoDate(periodStart),
    period_end: formatIsoDate(periodEnd),
    unit,
    unit_size: unitSize,
    grade: latestItem.grd_nm ?? null,
    variety: latestItem.vrty_nm ?? null,
    latest_price: parseNumber(latestItem.exmn_dd_avg_prc),
    average_price: computeAverage(averageValues),
    latest_price_date: formatIsoDate(latestItem.exmn_ymd ?? null),
    price_trend: computeTrend(sortedItems),
    unit_match: unitMatch,
    region_match: region.matched,
    price_comparison_allowed: false,
    verified: true,
    selected_for_prompt: false,
    selection_reason: null,
  });

  return {
    used: true,
    source: SOURCE_NAME,
    matched: true,
    merchant_product: merchantProduct,
    matched_item: match.itemName,
    matched_item_code: match.itemCode,
    region: region.regionName,
    region_code: region.regionCode,
    price_type: "retail",
    period_start: formatIsoDate(periodStart),
    period_end: formatIsoDate(periodEnd),
    unit,
    unit_size: unitSize,
    grade: latestItem.grd_nm ?? null,
    variety: latestItem.vrty_nm ?? null,
    latest_price: parseNumber(latestItem.exmn_dd_avg_prc),
    average_price: computeAverage(averageValues),
    latest_price_date: formatIsoDate(latestItem.exmn_ymd ?? null),
    price_trend: computeTrend(sortedItems),
    unit_match: unitMatch,
    region_match: region.matched,
    price_comparison_allowed: false,
    verified: true,
    selected_for_prompt: selected.kamis,
    selection_reason: selected.reason,
  };
}

export function buildKamisEvidenceItem(
  kamisContext: KamisContext,
) {
  if (!kamisContext.selected_for_prompt || !kamisContext.used || !kamisContext.verified) {
    return null;
  }

  return {
    type: "kamis" as const,
    source: kamisContext.source,
    value: [
      kamisContext.region,
      kamisContext.matched_item,
      "최근 소매가격 데이터",
    ]
      .filter((part): part is string => Boolean(part))
      .join(" / "),
  };
}

export async function getKamisContext(
  merchantProduct: string,
  marketContext: MarketContext,
  deps?: KamisClientDeps,
): Promise<KamisContext> {
  const match = matchMerchantProduct(merchantProduct);

  if (!match.matched || !match.itemCode) {
    return buildUnusedKamisContext(
      merchantProduct,
      match.reason ?? "product_not_supported",
    );
  }

  const region = resolveKamisRegion(marketContext);

  if (!region.matched || !region.regionCode) {
    return buildUnusedKamisContext(
      merchantProduct,
      region.reason ?? "region_not_supported",
    );
  }

  const now = getNow(deps);
  const config = getKamisApiEnv();
  const periodEnd = formatCompactDate(now);
  const periodStart = formatCompactDate(
    addDays(now, -Math.max(0, config.lookbackDays - 1)),
  );
  const cacheKey = getCacheKey(region.regionCode, match.itemCode, periodStart, periodEnd);
  const cached = kamisCache.get(cacheKey);

  if (cached && cached.expiresAt > now.getTime()) {
    return cached.value;
  }

  try {
    let pageNo = 1;
    const items: KamisItem[] = [];

    while (true) {
      const page = await fetchKamisPage(
        region.regionCode,
        match.itemCode,
        periodStart,
        periodEnd,
        pageNo,
        deps,
      );

      items.push(...page.items);

      if (page.pageNo * page.numOfRows >= page.totalCount || page.items.length === 0) {
        break;
      }

      pageNo += 1;
    }

    const context = buildKamisContext(
      merchantProduct,
      match,
      region,
      periodStart,
      periodEnd,
      items,
    );

    kamisCache.set(cacheKey, {
      expiresAt: now.getTime() + CACHE_TTL_MS,
      value: context,
    });

    return context;
  } catch {
    const fallback = buildApiUnavailableKamisContext(
      merchantProduct,
      match,
      region,
      periodStart,
      periodEnd,
    );

    kamisCache.set(cacheKey, {
      expiresAt: now.getTime() + CACHE_TTL_MS,
      value: fallback,
    });

    return fallback;
  }
}

export function clearKamisCache() {
  kamisCache.clear();
}

export function __testUtils() {
  return {
    matchMerchantProduct,
    resolveKamisRegion,
    detectMerchantUnitHint,
    normalizeProductKey,
    buildKamisEvidenceItem,
  };
}
