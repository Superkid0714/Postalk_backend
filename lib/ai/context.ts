import type { SubmissionForGeneration } from "@/lib/ai/generation";
import {
  buildKamisEvidenceItem,
  getKamisContext,
  type KamisContext,
} from "@/lib/public-data/kamis";
import {
  getFestivalContext,
  type FestivalContext,
} from "@/lib/public-data/tour-festival";
import {
  getTourismCorpusContext,
  type TourismCorpusContext,
} from "@/lib/public-data/tourism-corpus";
import {
  getMarketContext,
  type CaptionEvidenceItem,
  type MarketContext,
} from "@/lib/public-data/traditional-market";
import {
  getWeatherContext,
  type WeatherContext,
} from "@/lib/weather/context";

export type MerchantContext = {
  store_name: string | null;
  market_name: string | null;
  product: string;
  price: string | null;
  features: string[];
  appeal_point: string;
  target_customer: string | null;
  peak_sales_time: string | null;
  popular_menu_notes: string | null;
  extra_message: string | null;
};

export type CaptionInputContext = {
  merchant_context: MerchantContext;
  market_context: MarketContext;
  weather_context: WeatherContext;
  festival_context: FestivalContext;
  kamis_context: KamisContext;
  tourism_corpus_context: TourismCorpusContext;
  selected_context: {
    market: boolean;
    weather: boolean;
    festival: boolean;
    kamis: boolean;
    tourism_corpus: boolean;
  };
  selection_reason: {
    market: string | null;
    weather: string | null;
    festival: string | null;
    kamis: string | null;
    tourism_corpus: string | null;
  };
};

type BuildCaptionInputContextDeps = {
  marketContextLoader?: (marketName: string | null) => Promise<MarketContext>;
  festivalContextLoader?: (
    marketContext: MarketContext,
  ) => Promise<FestivalContext>;
  weatherContextLoader?: (
    marketContext: MarketContext,
  ) => Promise<WeatherContext>;
  kamisContextLoader?: (
    merchantProduct: string,
    marketContext: MarketContext,
  ) => Promise<KamisContext>;
  tourismCorpusContextLoader?: (params: {
    marketName: string | null;
    province: string | null;
    district: string | null;
    product: string;
    appealPoint: string;
    extraMessage: string | null;
  }) => Promise<TourismCorpusContext>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMerchantInsights(
  aiMetadata: Record<string, unknown> | null | undefined,
) {
  if (!isObject(aiMetadata) || !isObject(aiMetadata.merchantInsights)) {
    return {
      targetCustomer: null,
      peakSalesTime: null,
      popularMenuNotes: null,
    };
  }

  const record = aiMetadata.merchantInsights as Record<string, unknown>;

  return {
    targetCustomer:
      typeof record.targetCustomer === "string" ? record.targetCustomer : null,
    peakSalesTime:
      typeof record.peakSalesTime === "string" ? record.peakSalesTime : null,
    popularMenuNotes:
      typeof record.popularMenuNotes === "string" ? record.popularMenuNotes : null,
  };
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
    .map((value) => value.trim());
}

function joinFactParts(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(" / ");
}

export function buildMerchantContext(
  submission: SubmissionForGeneration,
): MerchantContext {
  const merchantInsights = readMerchantInsights(submission.ai_metadata);

  return {
    store_name: submission.stores?.store_name ?? null,
    market_name: submission.stores?.market_name ?? null,
    product: submission.target_menu_name,
    price: submission.price_text ?? null,
    features: uniqueNonEmpty([
      submission.appeal_point,
      submission.extra_message,
    ]),
    appeal_point: submission.appeal_point,
    target_customer: merchantInsights.targetCustomer,
    peak_sales_time: merchantInsights.peakSalesTime,
    popular_menu_notes: merchantInsights.popularMenuNotes,
    extra_message: submission.extra_message ?? null,
  };
}

export async function buildCaptionInputContext(
  submission: SubmissionForGeneration,
  deps?: BuildCaptionInputContextDeps,
): Promise<CaptionInputContext> {
  const merchantContext = buildMerchantContext(submission);
  const loadedMarketContext = await (
    deps?.marketContextLoader ?? getMarketContext
  )(merchantContext.market_name);
  const marketContext: MarketContext = {
    ...loadedMarketContext,
    latitude:
      typeof submission.stores?.latitude === "number"
        ? submission.stores.latitude
        : loadedMarketContext.latitude ?? null,
    longitude:
      typeof submission.stores?.longitude === "number"
        ? submission.stores.longitude
        : loadedMarketContext.longitude ?? null,
  };
  const weatherContext = await (
    deps?.weatherContextLoader ?? getWeatherContext
  )(marketContext);
  const festivalContext = await (
    deps?.festivalContextLoader ?? getFestivalContext
  )(marketContext);
  const kamisContext = await (
    deps?.kamisContextLoader ?? getKamisContext
  )(submission.target_menu_name, marketContext);
  const tourismCorpusContext = await (
    deps?.tourismCorpusContextLoader ?? getTourismCorpusContext
  )({
    marketName: merchantContext.market_name,
    province: marketContext.province,
    district: marketContext.district,
    product: merchantContext.product,
    appealPoint: merchantContext.appeal_point,
    extraMessage: merchantContext.extra_message,
  });

  const selectedContext = {
    market: marketContext.found,
    weather: weatherContext.selected_for_prompt && weatherContext.verified,
    festival: festivalContext.found && festivalContext.verified === true,
    kamis:
      kamisContext.selected_for_prompt &&
      kamisContext.used &&
      kamisContext.verified,
    tourism_corpus:
      tourismCorpusContext.selected_for_prompt && tourismCorpusContext.verified,
  };

  const selectionReason = {
    market: marketContext.found
      ? "전통시장 공공데이터에서 시장 정보가 확인됨"
      : "시장 공공데이터가 확인되지 않음",
    weather: weatherContext.selection_reason,
    festival: selectedContext.festival
      ? "가까운 시점의 지역 행사 정보가 확인됨"
      : "광고에 활용할 행사 정보가 없음",
    kamis: kamisContext.selection_reason,
    tourism_corpus: tourismCorpusContext.selection_reason,
  };

  return {
    merchant_context: merchantContext,
    market_context: marketContext,
    weather_context: weatherContext,
    festival_context: festivalContext,
    kamis_context: kamisContext,
    tourism_corpus_context: tourismCorpusContext,
    selected_context: selectedContext,
    selection_reason: selectionReason,
  };
}

export function buildMerchantEvidenceItems(
  merchantContext: MerchantContext,
): CaptionEvidenceItem[] {
  const value = joinFactParts([
    merchantContext.product,
    merchantContext.price,
    merchantContext.appeal_point,
    merchantContext.target_customer
      ? `주 고객층: ${merchantContext.target_customer}`
      : null,
    merchantContext.peak_sales_time
      ? `잘 팔리는 시간: ${merchantContext.peak_sales_time}`
      : null,
  ]);

  if (!value) {
    return [];
  }

  return [
    {
      type: "merchant",
      source: "merchant_input",
      value,
    },
  ];
}

export function buildMarketEvidenceItems(
  marketContext: MarketContext,
): CaptionEvidenceItem[] {
  if (!marketContext.found) {
    return [];
  }

  const locationValue = joinFactParts([
    marketContext.market_name,
    joinFactParts([marketContext.province, marketContext.district]),
    marketContext.road_address,
  ]);

  const facilities = [
    marketContext.facilities.arcade ? "아케이드" : null,
    marketContext.facilities.parking ? "주차장" : null,
    marketContext.facilities.rest_area ? "휴게실" : null,
    marketContext.facilities.luggage_storage ? "물품보관함" : null,
    marketContext.facilities.foreigner_information_center
      ? "외국인 안내센터"
      : null,
  ].filter((facility): facility is string => Boolean(facility));

  const evidence: CaptionEvidenceItem[] = [];

  if (locationValue) {
    evidence.push({
      type: "market",
      source: marketContext.source,
      value: locationValue,
    });
  }

  if (facilities.length > 0) {
    evidence.push({
      type: "market",
      source: marketContext.source,
      value: `확인된 편의시설: ${facilities.join(", ")}`,
    });
  }

  return evidence;
}

export function buildFestivalEvidenceItems(
  festivalContext: FestivalContext,
): CaptionEvidenceItem[] {
  if (!festivalContext.found || !festivalContext.verified) {
    return [];
  }

  const distanceText =
    typeof festivalContext.distance_km === "number"
      ? `시장 기준 ${festivalContext.distance_km.toFixed(1)}km`
      : null;

  const value = joinFactParts([
    festivalContext.title,
    festivalContext.event_start_date && festivalContext.event_end_date
      ? `${festivalContext.event_start_date}~${festivalContext.event_end_date}`
      : null,
    festivalContext.address,
    distanceText,
  ]);

  if (!value) {
    return [];
  }

  return [
    {
      type: "festival",
      source: festivalContext.source,
      value,
    },
  ];
}

export function buildWeatherEvidenceItems(
  weatherContext: WeatherContext,
): CaptionEvidenceItem[] {
  if (
    !weatherContext.found ||
    !weatherContext.verified ||
    !weatherContext.selected_for_prompt
  ) {
    return [];
  }

  const values = [
    weatherContext.summary,
    weatherContext.current?.temperature !== null &&
    typeof weatherContext.current?.temperature === "number"
      ? `현재 기온 ${Math.round(weatherContext.current.temperature)}도`
      : null,
    weatherContext.current?.precipitationType &&
    weatherContext.current.precipitationType !== "없음"
      ? `현재 강수 형태 ${weatherContext.current.precipitationType}`
      : null,
    weatherContext.forecast?.sky ? `예보 하늘 상태 ${weatherContext.forecast.sky}` : null,
  ].filter((value): value is string => Boolean(value?.trim()));

  if (values.length === 0) {
    return [];
  }

  return [
    {
      type: "weather",
      source: weatherContext.source,
      value: values.join(" / "),
    },
  ];
}

export function buildKamisEvidenceItems(
  kamisContext: KamisContext,
): CaptionEvidenceItem[] {
  const item = buildKamisEvidenceItem(kamisContext);
  return item ? [item] : [];
}

export function buildTourismCorpusEvidenceItems(
  tourismCorpusContext: TourismCorpusContext,
): CaptionEvidenceItem[] {
  if (!tourismCorpusContext.selected_for_prompt || !tourismCorpusContext.verified) {
    return [];
  }

  return tourismCorpusContext.examples.slice(0, 2).map((example) => ({
    type: "tourism_corpus",
    source: tourismCorpusContext.source,
    value: `${example.place_name} / ${example.category} / ${example.excerpt.slice(0, 120)}`,
  }));
}
