type EnvKey =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY";

type OptionalEnvKey =
  | "ADMIN_API_KEY"
  | "OPENAI_API_KEY"
  | "GEMINI_API_KEY"
  | "GEMINI_VIDEO_MODEL"
  | "INSTAGRAM_APP_ID"
  | "INSTAGRAM_APP_SECRET"
  | "INSTAGRAM_ACCESS_TOKEN"
  | "INSTAGRAM_IG_USER_ID"
  | "INSTAGRAM_GRAPH_API_VERSION";

function readEnv(key: EnvKey) {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function readOptionalEnv(key: OptionalEnvKey) {
  return process.env[key] ?? null;
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

export function getInstagramEnv() {
  return {
    appId: readOptionalEnv("INSTAGRAM_APP_ID"),
    appSecret: readOptionalEnv("INSTAGRAM_APP_SECRET"),
    accessToken: readOptionalEnv("INSTAGRAM_ACCESS_TOKEN"),
    igUserId: readOptionalEnv("INSTAGRAM_IG_USER_ID"),
    graphApiVersion: readOptionalEnv("INSTAGRAM_GRAPH_API_VERSION") ?? "v24.0",
  };
}
