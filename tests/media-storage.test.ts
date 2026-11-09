import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMediaStorage, getUploadStorageBucket, mediaObjectExists, readMediaStorageConfig, resolveMediaBucket } from "../lib/storage/media.ts";

const supabase = {
  storage: {
    from: (bucket: string) => ({
      marker: bucket,
      list: async () => ({ data: [{ id: "file-id", name: "photo.png" }], error: null }),
    }),
  },
} as unknown as SupabaseClient;

test("media storage uses only the private Supabase uploads bucket", () => {
  assert.deepEqual(readMediaStorageConfig({}), { provider: "supabase", bucket: "uploads" });
  assert.equal(getUploadStorageBucket(), "uploads");
  assert.deepEqual(resolveMediaBucket("uploads"), { provider: "supabase", bucket: "uploads" });
  assert.equal((getMediaStorage(supabase).from("uploads") as unknown as { marker: string }).marker, "uploads");
  assert.throws(() => readMediaStorageConfig({ MEDIA_STORAGE_PROVIDER: "other" }));
  assert.throws(() => resolveMediaBucket("other-bucket"));
});

test("media existence check reads from Supabase Storage", async () => {
  const result = await mediaObjectExists(supabase, "uploads", "stores/store/food_photo/photo.png");
  assert.equal(result.data, true);
  assert.equal(result.error, null);
});
