import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMediaStorage, getUploadStorageBucket, mediaObjectExists, readMediaStorageConfig, resolveMediaBucket } from "../lib/storage/media.ts";
import { getPreviewSignedUrl } from "../lib/storage/preview-url.ts";

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

test("preview URLs share concurrent signing, expire after five minutes, and retry failures", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  let calls = 0;
  let fail = false;
  const makeClient = () => ({ storage: { from: () => ({
    async createSignedUrl(path: string, expiresIn: number) {
      calls++;
      assert.equal(expiresIn, 3600);
      return fail
        ? { data: null, error: new Error("storage unavailable") }
        : { data: { signedUrl: `${path}?token=${calls}` }, error: null };
    },
  }) } }) as unknown as SupabaseClient;
  const client = makeClient();
  const path = "store/preview.png";
  const sign = () => getPreviewSignedUrl(client, "uploads", path);

  assert.deepEqual(await Promise.all([sign(), sign(), sign()]), Array(3).fill(`${path}?token=1`));
  t.mock.timers.tick(299_999);
  assert.equal(await sign(), `${path}?token=1`);
  assert.equal(calls, 1);
  assert.equal(await getPreviewSignedUrl(makeClient(), "uploads", path), `${path}?token=2`);
  assert.equal(await getPreviewSignedUrl(client, "uploads", "other/preview.png"), "other/preview.png?token=3");

  t.mock.timers.tick(1);
  fail = true;
  assert.equal(await sign(), null);
  fail = false;
  assert.equal(await sign(), `${path}?token=5`);
});
