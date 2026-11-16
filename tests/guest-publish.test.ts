import assert from "node:assert/strict";
import test from "node:test";
import { POST as publish } from "../app/api/submissions/[id]/publish/route.ts";
import { POST as openGuest } from "../app/api/guest-session/route.ts";

const STORE = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

test("guest publishing verifies ownership, completes the container and never reports acceptance as success", async t => {
  const env = { GUEST_CREATION_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: "https://guest-publish.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-service-key", INSTAGRAM_ACCESS_TOKEN: "test-instagram", INSTAGRAM_IG_USER_ID: "test-user" };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  let metadata: Record<string, unknown> = {};
  let containers = 0;
  let externalPosts = 0;
  let containerStatus = "FINISHED";
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === "guest-publish.invalid") {
      if (url.pathname.endsWith("/stores")) return request.method === "POST" ? new Response(null, { status: 201 }) : Response.json([{ id: STORE }]);
      if (url.pathname.endsWith("/rpc/claim_submission_publish")) return Response.json(true);
      if (url.pathname.endsWith("/rpc/update_submission_instagram_metadata")) {
        metadata = { ...metadata, ...(await request.json()).p_updates };
        return Response.json(null);
      }
      if (url.pathname.endsWith("/submission_publish_leases")) return Response.json([]);
      if (url.pathname.includes("/storage/v1/object/sign/")) return Response.json({ signedURL: "/object/sign/uploads/asset.jpg?token=mock" });
      if (url.pathname.endsWith("/submissions")) {
        if (url.searchParams.get("select") === "store_id") return Response.json({ store_id: url.searchParams.get("id") === `eq.${OTHER}` ? OTHER : STORE });
        return Response.json({ id: ID, status: "draft", caption: "소개", hashtags: [], ai_metadata: { instagramPublish: metadata },
          generation_jobs: [{ id: "job", status: "completed", model_name: "postalk-cardnews", result_asset_id: "asset", result_payload: {}, created_at: "2026-11-16T00:00:00Z" }],
          submission_assets: [{ id: "asset", asset_type: "generated_image", storage_bucket: "uploads", file_path: "asset.jpg" }],
        });
      }
    }
    if (url.hostname === "graph.instagram.com") {
      if (url.pathname.endsWith("/test-user/media")) { containers++; return Response.json({ id: "container" }); }
      if (url.pathname.endsWith("/container")) return Response.json({ status_code: containerStatus });
      if (url.pathname.endsWith("/media_publish")) { externalPosts++; return Response.json({ id: "123456789" }); }
      if (url.pathname.endsWith("/123456789")) return Response.json({ permalink: "https://www.instagram.com/p/test/" });
    }
    throw new Error(`Unexpected mocked request ${request.method} ${url.pathname}`);
  });
  const headers = { "x-guest-session": "a".repeat(64) };
  // Proxies may forward a zero-byte stream rather than a null Request.body.
  const click = (id = ID, authenticated = true) => publish(new Request("http://localhost/api/submissions/test/publish", { method: "POST", body: "", headers: authenticated ? headers : {} }), { params: Promise.resolve({ id }) });
  const workspace = await openGuest(new Request("http://localhost/api/guest-session", { method: "POST", headers }));
  assert.equal((await workspace.json()).data.canPublish, true);
  assert.equal((await click(ID, false)).status, 401);
  assert.equal((await click(OTHER)).status, 403);
  assert.equal(containers, 0);
  const completed = await click();
  assert.equal(completed.status, 200);
  assert.equal((await completed.json()).data.status, "published");
  assert.equal(externalPosts, 1);
  assert.equal(containers, 1);
  assert.equal((await click()).status, 200);
  assert.equal(externalPosts, 1, "repeat clicks must not create another post");
  metadata = { status: "processing", mediaType: "photo", containerId: "container", outcomeUnknown: true };
  const uncertain = await click();
  assert.equal(uncertain.status, 409);
  assert.equal((await uncertain.json()).error.code, "INSTAGRAM_VERIFICATION_REQUIRED");
  assert.equal(externalPosts, 1);
  metadata = { status: "processing", mediaType: "photo", containerId: "container" };
  containerStatus = "IN_PROGRESS";
  const pending = await click();
  assert.equal(pending.status, 409, "accepted containers must not be reported as a successful post");
  assert.equal((await pending.json()).error.code, "INSTAGRAM_PROCESSING");
  assert.equal(externalPosts, 1);
  metadata = { status: "processing", mediaType: "photo", containerId: "container" };
  containerStatus = "ERROR";
  assert.equal((await click()).status, 502);
  assert.equal(externalPosts, 1);
});
