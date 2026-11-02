import assert from "node:assert/strict";
import test from "node:test";
import { startInstagramPublishForSubmission, syncInstagramPublishForSubmission } from "../lib/instagram/publish.ts";

test("publishing never repeats an uncertain external side effect", async (t) => {
  const originalFetch = globalThis.fetch;
  const values = { NEXT_PUBLIC_SUPABASE_URL: "https://postalk-test.invalid", SUPABASE_SERVICE_ROLE_KEY: "fake-service-role", INSTAGRAM_ACCESS_TOKEN: "fake-instagram", INSTAGRAM_IG_USER_ID: "fake-user" };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  let metadata: Record<string, unknown>;
  let externalPosts = 0;
  let failExternal = false;
  let failPersistence = false;
  const id = "11111111-1111-4111-8111-111111111111";
  const reset = () => { metadata = { mediaType: "video", status: "processing", containerId: "container", requestedAt: "2026-11-02T00:00:00Z" }; externalPosts = 0; failExternal = false; failPersistence = false; };
  const json = (value: unknown) => Response.json(value);
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === "postalk-test.invalid") {
      if (url.pathname.endsWith("/rpc/claim_submission_publish")) return json(true);
      if (url.pathname.endsWith("/rpc/update_submission_instagram_metadata")) {
        const body = await request.json() as { p_updates: Record<string, unknown> };
        if (failPersistence && body.p_updates.status === "published") return Response.json({ message: "simulated DB outage" }, { status: 503 });
        metadata = { ...metadata, ...body.p_updates };
        return json(null);
      }
      if (url.pathname.endsWith("/submission_publish_leases") && request.method === "DELETE") return json([]);
      if (url.pathname.endsWith("/submissions")) return json({ id, status: "draft", ai_metadata: { instagramPublish: metadata }, generation_jobs: [], submission_assets: [] });
    }
    if (url.hostname === "graph.instagram.com") {
      if (url.pathname.endsWith("/media_publish")) {
        assert.equal(metadata.publishAttemptedAt != null, true, "intention must be durable before POST");
        assert.equal(metadata.outcomeUnknown, true);
        externalPosts++;
        if (failExternal) throw new TypeError("simulated lost response");
        return json({ id: "123456789" });
      }
      if (url.pathname.endsWith("/container")) return json({ status_code: "FINISHED" });
      if (url.pathname.endsWith("/123456789")) return json({ permalink: "https://www.instagram.com/p/test/" });
    }
    throw new Error(`Unexpected mocked request: ${request.method} ${url.origin}${url.pathname}`);
  };
  try {
    await t.test("lost response blocks duplicate posts across sync and repeated publish clicks", async () => {
      reset(); failExternal = true;
      await assert.rejects(syncInstagramPublishForSubmission(id), /lost response/);
      assert.equal(externalPosts, 1);
      const recovered = await syncInstagramPublishForSubmission(id);
      assert.equal(recovered.requiresVerification, true);
      const clickedAgain = await startInstagramPublishForSubmission(id);
      assert.equal(clickedAgain.requiresVerification, true);
      assert.equal(externalPosts, 1);
    });
    await t.test("successful POST followed by a DB outage is not repeated", async () => {
      reset(); failPersistence = true;
      await assert.rejects(syncInstagramPublishForSubmission(id), /DB outage/);
      failPersistence = false;
      assert.equal((await syncInstagramPublishForSubmission(id)).requiresVerification, true);
      assert.equal(externalPosts, 1);
    });
    await t.test("a confirmed publish clears uncertainty and remains idempotent", async () => {
      reset();
      const result = await syncInstagramPublishForSubmission(id);
      assert.equal(result.status, "published");
      assert.equal(metadata.outcomeUnknown, false);
      assert.equal((await startInstagramPublishForSubmission(id)).status, "published");
      assert.equal(externalPosts, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
