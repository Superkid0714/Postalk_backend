import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildReelsInput, renderReelInStorage, REELS_SHOT_PLAN } from "../lib/ai/reels.ts";

test("reels sends four signed clips in scene order and resumes an already accepted render", async (t) => {
  const env = { REELS_API_URL: "http://reels.example:8000", REELS_INTERNAL_API_KEY: "reels-test" };
  const before = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const filePath = "store/submission/generated/job.mp4";
  const thumbnailPath = filePath.replace(".mp4", ".jpg");
  const calls: string[] = [];
  const client = { storage: { from: (bucket: string) => {
    assert.equal(bucket, "uploads");
    return {
      createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.example/object/sign/${path}` } }),
      createSignedUploadUrl: async (path: string, options: object) => {
        assert.deepEqual(options, { upsert: true });
        return { data: { signedUrl: `https://storage.example/object/upload/sign/${path}` } };
      },
    };
  } } } as unknown as SupabaseClient;
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    calls.push(url.pathname);
    assert.equal(new Headers(init.headers).get("x-reels-api-key"), "reels-test");
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.ad_id, "job");
      assert.equal(body.concept, "simple");
      assert.deepEqual(body.media.map((item: { key: string; menu_index: number | null }) => [item.key, item.menu_index]),
        REELS_SHOT_PLAN.map((shot, index) => [shot, index === 1 || index === 2 ? 0 : null]));
      assert.ok(body.media.every((item: { download_url: string }) => item.download_url.startsWith("https://storage.example/")));
      assert.equal(body.uploads.video_url, `https://storage.example/object/upload/sign/${filePath}`);
      assert.equal(Array.from(body.scenes[0].text).length, 14);
      return Response.json({ detail: { code: "ALREADY_RENDERING", render_id: "rr_abc" } }, { status: 409 });
    }
    return Response.json({ status: "done", result: {
      video_key: filePath, thumbnail_key: thumbnailPath, video_bytes: 123, thumbnail_bytes: 40, duration_sec: 13,
    } });
  });

  const result = await renderReelInStorage({
    client, jobId: "job", filePath,
    sources: [...REELS_SHOT_PLAN].reverse().map(shotKey => ({ shotKey, storageBucket: "uploads", filePath: shotKey })),
    input: buildReelsInput({ storeName: "가게", storeDescription: "소개", menuName: "떡볶이",
      script: { hookText: "🍜".repeat(20), caption: "가게 소개", hashtags: [], workingCaptions: [] } }),
  });
  assert.deepEqual(calls, ["/reels/renders", "/reels/renders/rr_abc"]);
  assert.deepEqual(result, { renderId: "rr_abc", thumbnailPath, videoBytes: 123, thumbnailBytes: 40, durationSeconds: 13 });
});
