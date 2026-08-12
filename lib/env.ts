type EnvKey =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY";

type OptionalEnvKey = "ADMIN_API_KEY" | "OPENAI_API_KEY";

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

export function getAdminApiKey() {
  return readOptionalEnv("ADMIN_API_KEY");
}

export function getOpenAiApiKey() {
  return readOptionalEnv("OPENAI_API_KEY");
}
