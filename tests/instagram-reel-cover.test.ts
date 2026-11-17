import assert from "node:assert/strict";
import test from "node:test";
import { startInstagramPublishForSubmission } from "../lib/instagram/publish.ts";

test("reel creation sends the signed JPEG cover and uses an offset only for legacy outputs", async t => {
  const originalFetch = globalThis.fetch;
  const values = { NEXT_PUBLIC_SUPABASE_URL: "https://postalk-cover.invalid", SUPABASE_SERVICE_ROLE_KEY: "fake-service", INSTAGRAM_ACCESS_TOKEN: "fake-instagram", INSTAGRAM_IG_USER_ID: "fake-user" };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  const id = "11111111-1111-4111-8111-111111111111";
  let hasCover = true;
  let form: URLSearchParams;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith("/rpc/claim_submission_publish")) return Response.json(true);
    if (url.pathname.endsWith("/rpc/update_submission_instagram_metadata")) return Response.json(null);
    if (url.pathname.endsWith("/submission_publish_leases")) return Response.json([]);
    if (url.pathname.endsWith("/submissions")) return Response.json({
      id, status: "draft", caption: "실제 판매점이 아닌 테스트 콘텐츠입니다.", hashtags: [], ai_metadata: {},
      generation_jobs: [{ id: "job", status: "completed", model_name: "postalk-reels", result_asset_id: "video", result_payload: hasCover ? { thumbnailAssetId: "cover" } : {}, created_at: "2026-11-18" }],
      submission_assets: [
        { id: "video", asset_type: "generated_video", storage_bucket: "uploads", file_path: "video.mp4", mime_type: "video/mp4" },
        { id: "cover", asset_type: "video_thumbnail", storage_bucket: "uploads", file_path: "cover.jpg", mime_type: "image/jpeg" },
      ],
    });
    if (url.pathname.includes("/storage/v1/object/sign/")) return Response.json({ signedURL: "/object/sign/uploads/" + url.pathname.split("/").pop() + "?token=fake" });
    if (url.hostname === "graph.instagram.com" && url.pathname.endsWith("/media")) {
      form = new URLSearchParams(await request.text());
      return Response.json({ id: "container" });
    }
    throw new Error("Unexpected request: " + request.method + " " + url.pathname);
  };
  try {
    await t.test("completed output cover is passed to Meta", async () => {
      const result = await startInstagramPublishForSubmission(id, { mediaType: "video" });
      assert.equal(result.status, "processing");
      assert.equal(form.get("media_type"), "REELS");
      assert.match(form.get("cover_url")!, /cover\.jpg/);
      assert.equal(form.has("thumb_offset"), false);
      assert.match(form.get("caption")!, /실제 판매점이 아닌/);
    });
    await t.test("legacy video avoids default frame zero", async () => {
      hasCover = false;
      await startInstagramPublishForSubmission(id, { mediaType: "video" });
      assert.equal(form.has("cover_url"), false);
      assert.equal(form.get("thumb_offset"), "1000");
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
