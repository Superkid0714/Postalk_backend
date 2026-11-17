import assert from "node:assert/strict";
import test from "node:test";
import { buildArchiveItem, type ArchiveSubmissionRecord } from "../lib/archive.ts";

test("archive keeps video playback and JPEG cover fields distinct regardless of asset order", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://postalk-archive.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
  globalThis.fetch = async (input, init) => {
    const url = new URL(new Request(input, init).url);
    assert.ok(url.pathname.includes("/storage/v1/object/sign/"));
    return Response.json({ signedURL: "/object/sign/uploads/" + url.pathname.split("/").pop() + "?token=fake" });
  };
  const video = { asset_type: "generated_video" as const, storage_bucket: "uploads", file_path: "reel.mp4", sort_order: 0 };
  const thumbnail = { ...video, asset_type: "video_thumbnail" as const, file_path: "cover.jpg" };
  const row: ArchiveSubmissionRecord = {
    id: "test", title: "쿠키", target_menu_name: "쿠키", status: "draft", created_at: "2026-11-18", updated_at: "2026-11-18", stores: null,
  };
  try {
    for (const assets of [[video, thumbnail], [thumbnail, video], [video]]) {
      const item = await buildArchiveItem({ ...row, submission_assets: assets }, "video");
      assert.match(item.generatedAssetUrl!, /reel\.mp4/);
      if (assets.length === 2) assert.match(item.thumbnailUrl!, /cover\.jpg/);
      else assert.equal(item.thumbnailUrl, null);
    }
    const missingVideo = await buildArchiveItem({ ...row, submission_assets: [thumbnail] }, "video");
    assert.equal(missingVideo.generatedAssetUrl, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
