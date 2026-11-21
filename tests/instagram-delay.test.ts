import assert from "node:assert/strict";
import test from "node:test";
import { recoverRequestedInstagramPublishes } from "../lib/instagram/recover-pending.ts";
import { startInstagramPublishForSubmission, waitForInstagramPublishCompletion } from "../lib/instagram/publish.ts";

test("publication completion is scoped, ordered and safe under concurrent checks", async t => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://publication-delay.invalid", SUPABASE_SERVICE_ROLE_KEY: "fake-key", INSTAGRAM_ACCESS_TOKEN: "fake-token", INSTAGRAM_IG_USER_ID: "fake-user" };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const originalFetch = globalThis.fetch;
  const id = "11111111-1111-4111-8111-111111111111";
  let metadata: Record<string, unknown> = {};
  let queue: unknown[] = [];
  let carousel = false;
  let busy = false;
  let deleted = false;
  let published = 0;
  let activeChildren = 0;
  let maxChildren = 0;
  let parentOrder = "";
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === "publication-delay.invalid") {
      if (url.pathname.endsWith("/rpc/claim_submission_publish")) return Response.json(!busy);
      if (url.pathname.endsWith("/rpc/update_submission_instagram_metadata")) {
        const body = await request.json() as { p_updates: Record<string, unknown> };
        metadata = { ...metadata, ...body.p_updates };
        return Response.json(null);
      }
      if (url.pathname.endsWith("/submission_publish_leases")) return Response.json([]);
      if (url.pathname.includes("/storage/v1/object/sign/")) return Response.json({ signedURL: "/object/sign/uploads/" + url.pathname.split("/").pop() + "?token=fake" });
      if (url.pathname.endsWith("/submissions")) {
        if (url.searchParams.has("ai_metadata->instagramPublish->>autoCompleteRequested")) {
          assert.equal(url.searchParams.get("ai_metadata->instagramPublish->>autoCompleteRequested"), "eq.true");
          assert.equal(url.searchParams.get("ai_metadata->instagramPublish->>publishAttemptedAt"), "is.null");
          assert.ok(url.searchParams.get("ai_metadata->instagramPublish->>requestedAt")?.startsWith("gte."));
          return Response.json(queue);
        }
        const assets = Array.from({ length: 4 }, (_, index) => ({ id: "asset-" + (index + 1), asset_type: "generated_image", storage_bucket: "uploads", file_path: (index + 1) + ".jpg", mime_type: "image/jpeg" }));
        return Response.json({ id, status: "draft", caption: "테스트", hashtags: [], ai_metadata: { instagramPublish: metadata, exhibitionDeletedAt: deleted ? new Date().toISOString() : undefined },
          generation_jobs: carousel ? [{ id: "job", status: "completed", model_name: "postalk-cardnews", result_asset_id: "asset-1", result_payload: { generatedImages: assets.map(asset => ({ assetId: asset.id })) }, created_at: "2026-11-21" }] : [],
          submission_assets: carousel ? assets : [],
        });
      }
    }
    if (url.hostname === "graph.instagram.com") {
      if (url.pathname.endsWith("/media_publish")) { published++; return Response.json({ id: "published" }); }
      if (url.pathname.endsWith("/published")) return Response.json({ permalink: "https://www.instagram.com/p/test/" });
      if (url.pathname.endsWith("/container")) return Response.json({ status_code: "FINISHED" });
      if (url.pathname.endsWith("/media")) {
        const form = new URLSearchParams(await request.text());
        if (form.get("is_carousel_item") === "true") {
          activeChildren++; maxChildren = Math.max(maxChildren, activeChildren);
          const number = Number(new URL(form.get("image_url")!).pathname.match(/(\d)\.jpg/)![1]);
          await new Promise(resolve => setTimeout(resolve, number % 2 ? 25 : 5));
          activeChildren--;
          return Response.json({ id: "child-" + number });
        }
        parentOrder = form.get("children")!;
        return Response.json({ id: "carousel" });
      }
    }
    throw new Error("Unexpected mocked request: " + request.method + " " + url.pathname);
  };
  try {
    await t.test("old, unmarked, uncertain and attempted requests never publish", async () => {
      const eligible = { status: "processing", mediaType: "video", containerId: "container", requestedAt: new Date().toISOString(), autoCompleteRequested: true };
      metadata = { ...eligible };
      queue = [
        { id: "old", ai_metadata: { instagramPublish: { ...eligible, requestedAt: "2020-01-01T00:00:00Z" } } },
        { id: "deleted", ai_metadata: { exhibitionDeletedAt: new Date().toISOString(), instagramPublish: eligible } },
        { id: "unmarked", ai_metadata: { instagramPublish: { ...eligible, autoCompleteRequested: false } } },
        { id: "uncertain", ai_metadata: { instagramPublish: { ...eligible, outcomeUnknown: true } } },
        { id: "attempted", ai_metadata: { instagramPublish: { ...eligible, publishAttemptedAt: new Date().toISOString() } } },
        { id, ai_metadata: { instagramPublish: eligible } },
      ];
      const results = await recoverRequestedInstagramPublishes();
      assert.equal(results.length, 1);
      assert.equal(results[0].status, "published");
      assert.equal(published, 1);
      assert.equal(metadata.outcomeUnknown, false);
    });
    await t.test("carousel child creation runs two at a time and retains order", async () => {
      carousel = true; metadata = {};
      const result = await startInstagramPublishForSubmission(id, { mediaType: "photo", autoCompleteRequested: true });
      assert.equal(result.status, "processing");
      assert.equal(metadata.autoCompleteRequested, true);
      assert.equal(maxChildren, 2);
      assert.equal(parentOrder, "child-1,child-2,child-3,child-4");
    });
    await t.test("waiting joins a busy completion instead of failing the request", async () => {
      busy = true;
      const result = await waitForInstagramPublishCompletion(id, { maxAttempts: 1, delayMs: 0 });
      assert.equal(result.status, "processing");
      assert.equal(published, 1);
    });
    await t.test("an exhausted foreground budget starts no new Meta operation", async () => {
      busy = false;
      const result = await waitForInstagramPublishCompletion(id, { maxAttempts: 20, delayMs: 0, maxWaitMs: 0 });
      assert.equal(result.status, "processing");
      assert.equal(published, 1);
    });
    await t.test("deleted advertisements cannot publish after a concurrent check", async () => {
      busy = false; deleted = true;
      await assert.rejects(waitForInstagramPublishCompletion(id, { maxAttempts: 1, delayMs: 0 }), /Deleted ads/);
      assert.equal(published, 1);
      deleted = false;
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
