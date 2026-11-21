import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/internal/generation-jobs/recover/route.ts";

test("generation recovery requires its key and does not start Instagram work by default", async () => {
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "INTERNAL_WORKER_API_KEY", "EXHIBITION_MODE_ENABLED", "GENERATION_WORKER_SYNC_INSTAGRAM_ENABLED"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: "https://recovery-test.invalid", SUPABASE_SERVICE_ROLE_KEY: "fake-service", INTERNAL_WORKER_API_KEY: "worker-key", EXHIBITION_MODE_ENABLED: "false" });
  delete process.env.GENERATION_WORKER_SYNC_INSTAGRAM_ENABLED;
  const originalFetch = globalThis.fetch;
  let publishQueries = 0;
  let generationQueries = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(new Request(input, init).url);
    if (url.pathname.endsWith("/generation_jobs")) { generationQueries++; return Response.json([]); }
    if (url.pathname.endsWith("/submissions")) { publishQueries++; return Response.json([]); }
    throw new Error("Unexpected recovery request");
  };
  try {
    const unauthorized = await POST(new NextRequest("https://backend.invalid/api/internal/generation-jobs/recover", { method: "POST" }));
    assert.equal(unauthorized.status, 401);
    const request = () => new NextRequest("https://backend.invalid/api/internal/generation-jobs/recover", { method: "POST", headers: { "x-internal-worker-key": "worker-key" } });
    const response = await POST(request());
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data.results, []);
    assert.equal(publishQueries, 0);
    process.env.GENERATION_WORKER_SYNC_INSTAGRAM_ENABLED = "true";
    assert.equal((await POST(request())).status, 200);
    assert.equal(publishQueries, 1);
    const before = generationQueries;
    const publicationOnly = await POST(new NextRequest("https://backend.invalid/api/internal/generation-jobs/recover?scope=publish", {
      method: "POST", headers: { "x-internal-worker-key": "worker-key" },
    }));
    assert.equal(publicationOnly.status, 200);
    assert.equal(generationQueries, before, "publication checks must not run AI jobs");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { const value = previous[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
