import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createInstagramMediaUrl } from "../lib/instagram/media.ts";

test("PNG cards become JPEG publication copies while original paths remain unchanged", async () => {
  const source = await sharp({ create: { width: 1080, height: 1350, channels: 4, background: { r: 200, g: 100, b: 50, alpha: 0.5 } } }).png().toBuffer();
  let uploads = 0;
  const asset = { asset_type: "generated_image", storage_bucket: "uploads", file_path: "store/generated/card.png", mime_type: "image/png" };
  const client = { storage: { from(bucket: string) {
    assert.equal(bucket, "uploads");
    return {
      download: async (path: string) => { assert.equal(path, asset.file_path); return { data: new Blob([new Uint8Array(source)]), error: null }; },
      upload: async (path: string, bytes: Buffer, options: object) => {
        uploads++;
        assert.equal(path, `${asset.file_path}.instagram.jpg`);
        assert.deepEqual(options, { upsert: true, contentType: "image/jpeg" });
        const image = await sharp(bytes).metadata();
        assert.equal(image.format, "jpeg");
        assert.equal(image.width, 1080);
        assert.equal(image.height, 1350);
        assert.equal(image.hasAlpha, false);
        return { error: null };
      },
      createSignedUrl: async (path: string, expires: number) => {
        assert.equal(expires, 21600);
        return { data: { signedUrl: `https://storage.test/${path}` }, error: null };
      },
    };
  } } } as unknown as SupabaseClient;
  assert.equal(await createInstagramMediaUrl(client, asset), `https://storage.test/${asset.file_path}.instagram.jpg`);
  assert.equal(asset.file_path, "store/generated/card.png");
  assert.equal(uploads, 1);
});

test("JPEG and video assets are signed directly without downloading or rewriting", async () => {
  const client = { storage: { from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: path }, error: null }) }) } } as unknown as SupabaseClient;
  for (const asset of [
    { asset_type: "generated_image", storage_bucket: "uploads", file_path: "card.jpg", mime_type: "image/jpeg" },
    { asset_type: "generated_video", storage_bucket: "uploads", file_path: "reel.mp4", mime_type: "video/mp4" },
  ]) assert.equal(await createInstagramMediaUrl(client, asset), asset.file_path);
});

test("a failed conversion download never produces a signed publication URL", async () => {
  const client = { storage: { from: () => ({ download: async () => ({ data: null, error: { message: "offline" } }) }) } } as unknown as SupabaseClient;
  await assert.rejects(createInstagramMediaUrl(client, { asset_type: "generated_image", storage_bucket: "uploads", file_path: "card.png" }), /사진을 불러오지 못했어요/);
});
