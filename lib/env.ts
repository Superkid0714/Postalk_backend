type EnvKey =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY";

type OptionalEnvKey =
  | "ADMIN_API_KEY"
  | "OPENAI_API_KEY"
  | "GEMINI_API_KEY"
  | "GEMINI_VIDEO_MODEL"
  | "NEXT_PUBLIC_APP_URL"
  | "PUBLIC_APP_URL"
  | "QUOTE_VIDEO_API_URL"
  | "QUOTE_VIDEO_API_KEY"
  | "QUOTE_VIDEO_BGM_URL"
  | "QUOTE_VIDEO_TIMEOUT_SECONDS"
  | "INSTAGRAM_APP_ID"
  | "INSTAGRAM_APP_SECRET"
  | "INSTAGRAM_ACCESS_TOKEN"
  | "INSTAGRAM_IG_USER_ID"
  | "INSTAGRAM_GRAPH_API_VERSION"
  | "DATA_GO_KR_SERVICE_KEY"
  | "TOUR_API_SERVICE_KEY"
  | "TOUR_API_BASE_URL"
  | "TOUR_API_MOBILE_OS"
  | "TOUR_API_MOBILE_APP"
  | "FESTIVAL_LOOKAHEAD_DAYS"
  | "FESTIVAL_MAX_DISTANCE_KM"
  | "KAMIS_API_SERVICE_KEY"
  | "KAMIS_LOOKBACK_DAYS"
  | "TOURISM_CORPUS_REPORT_PATH"
  | "TOURISM_CORPUS_MAX_ITEMS"
  | "WEATHER_API_BASE_URL"
  | "WEATHER_API_SERVICE_KEY"
  | "WEATHER_API_RESPONSE_FORMAT";

function readEnv(key: EnvKey) {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function readOptionalEnv(key: OptionalEnvKey) {
  const value = process.env[key];

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
}

export function getSupabaseEnv() {
  return {
    url: readEnv("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceRoleKey: readEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function getSupabaseAdminEnv() {
  return {
    url: readEnv("NEXT_PUBLIC_SUPABASE_URL"),
    serviceRoleKey: readEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function getAdminApiKey() {
  return readOptionalEnv("ADMIN_API_KEY");
}

export function getOpenAiApiKey() {
  return readOptionalEnv("OPENAI_API_KEY");
}

export function getGeminiApiKey() {
  return readOptionalEnv("GEMINI_API_KEY");
}

export function getGeminiVideoModel() {
  return readOptionalEnv("GEMINI_VIDEO_MODEL");
}

export function getPublicAppUrl() {
  const explicit =
    readOptionalEnv("NEXT_PUBLIC_APP_URL") ??
    readOptionalEnv("PUBLIC_APP_URL") ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ??
    process.env.VERCEL_URL?.trim() ??
    null;

  if (!explicit) {
    return null;
  }

  if (explicit.startsWith("http://") || explicit.startsWith("https://")) {
    return explicit;
  }

  return `https://${explicit}`;
}

export function getQuoteVideoEnv() {
  return {
    apiUrl: readOptionalEnv("QUOTE_VIDEO_API_URL"),
    apiKey: readOptionalEnv("QUOTE_VIDEO_API_KEY"),
    bgmUrl: readOptionalEnv("QUOTE_VIDEO_BGM_URL"),
    timeoutSeconds: Number.parseInt(
      readOptionalEnv("QUOTE_VIDEO_TIMEOUT_SECONDS") ?? "120",
      10,
    ),
  };
}

export function getInstagramEnv() {
  return {
    appId: readOptionalEnv("INSTAGRAM_APP_ID"),
    appSecret: readOptionalEnv("INSTAGRAM_APP_SECRET"),
    accessToken: readOptionalEnv("INSTAGRAM_ACCESS_TOKEN"),
    igUserId: readOptionalEnv("INSTAGRAM_IG_USER_ID"),
    graphApiVersion: readOptionalEnv("INSTAGRAM_GRAPH_API_VERSION") ?? "v24.0",
  };
}

export function getDataGoKrServiceKey() {
  return readOptionalEnv("DATA_GO_KR_SERVICE_KEY");
}

export function getTourApiEnv() {
  return {
    serviceKey: readOptionalEnv("TOUR_API_SERVICE_KEY"),
    baseUrl:
      readOptionalEnv("TOUR_API_BASE_URL") ??
      "https://apis.data.go.kr/B551011/KorService2",
    mobileOs: readOptionalEnv("TOUR_API_MOBILE_OS") ?? "ETC",
    mobileApp: readOptionalEnv("TOUR_API_MOBILE_APP") ?? "POSTALK",
    lookaheadDays: Number.parseInt(
      readOptionalEnv("FESTIVAL_LOOKAHEAD_DAYS") ?? "7",
      10,
    ),
    maxDistanceKm: Number.parseFloat(
      readOptionalEnv("FESTIVAL_MAX_DISTANCE_KM") ?? "5",
    ),
  };
}

export function getWeatherApiEnv() {
  return {
    baseUrl:
      readOptionalEnv("WEATHER_API_BASE_URL") ??
      "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0",
    serviceKey: readOptionalEnv("WEATHER_API_SERVICE_KEY"),
    responseFormat: readOptionalEnv("WEATHER_API_RESPONSE_FORMAT") ?? "JSON",
  };
}

export function getKamisApiEnv() {
  return {
    serviceKey: readOptionalEnv("KAMIS_API_SERVICE_KEY"),
    baseUrl: "https://apis.data.go.kr/B552845/perRegion",
    lookbackDays: Number.parseInt(
      readOptionalEnv("KAMIS_LOOKBACK_DAYS") ?? "7",
      10,
    ),
  };
}

export function getTourismCorpusEnv() {
  return {
    reportPath: readOptionalEnv("TOURISM_CORPUS_REPORT_PATH"),
    maxItems: Number.parseInt(
      readOptionalEnv("TOURISM_CORPUS_MAX_ITEMS") ?? "3",
      10,
    ),
  };
}
