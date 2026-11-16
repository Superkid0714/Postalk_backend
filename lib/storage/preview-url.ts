import type { SupabaseClient } from "@supabase/supabase-js";
import { getMediaStorage } from "@/lib/storage/media";

const URL_LIFETIME_SECONDS = 60 * 60;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 512;

type PreviewEntry = { expiresAt: number; url: Promise<string | null> };
const caches = new WeakMap<SupabaseClient, Map<string, PreviewEntry>>();

/** Call only after authorizing access to the stored asset. Cache the URL, not the authorization. */
export function getPreviewSignedUrl(client: SupabaseClient, bucket: string, filePath: string): Promise<string | null> {
  let cache = caches.get(client);
  if (!cache) {
    cache = new Map();
    caches.set(client, cache);
  }
  const key = JSON.stringify([bucket, filePath]);
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) return existing.url;
  cache.delete(key);

  const url = Promise.resolve().then(async () => {
    const result = await getMediaStorage(client).from(bucket).createSignedUrl(filePath, URL_LIFETIME_SECONDS);
    return result.error ? null : result.data?.signedUrl ?? null;
  });
  const entry = { expiresAt: now + CACHE_TTL_MS, url };
  cache.set(key, entry);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }

  const remove = () => {
    if (cache.get(key) === entry) cache.delete(key);
  };
  void url.then(value => { if (!value) remove(); }, remove);
  return url;
}
