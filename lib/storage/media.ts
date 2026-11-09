import type { SupabaseClient } from "@supabase/supabase-js";

export type MediaStorageConfig = {
  provider: "supabase";
  bucket: "uploads";
};

export function readMediaStorageConfig(env: Record<string, string | undefined> = process.env): MediaStorageConfig {
  const provider = env.MEDIA_STORAGE_PROVIDER?.trim() || "supabase";
  if (provider !== "supabase") throw new Error("MEDIA_STORAGE_PROVIDER must be supabase");
  return { provider: "supabase", bucket: "uploads" };
}

export function getUploadStorageBucket() {
  return "uploads" as const;
}

export function resolveMediaBucket(reference: string) {
  if (reference !== "uploads") throw new Error("Only the Supabase uploads bucket is supported");
  return { provider: "supabase" as const, bucket: "uploads" as const };
}

function storageError(error: unknown) {
  return { message: error instanceof Error ? error.message : "Media storage request failed" };
}

export function getMediaStorage(supabase: SupabaseClient) {
  return {
    from(reference: string) {
      return supabase.storage.from(resolveMediaBucket(reference).bucket);
    },
  };
}

export async function mediaObjectExists(supabase: SupabaseClient, reference: string, key: string) {
  try {
    const { bucket } = resolveMediaBucket(reference);
    const slash = key.lastIndexOf("/");
    const name = key.slice(slash + 1);
    const { data, error } = await supabase.storage.from(bucket).list(key.slice(0, slash), { search: name, limit: 100 });
    return { data: Boolean(data?.some(file => file.name === name && file.id)), error };
  } catch (error) {
    return { data: false, error: storageError(error) };
  }
}
