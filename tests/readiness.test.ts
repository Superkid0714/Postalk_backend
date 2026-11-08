import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "../app/api/health/ready/route.ts";

test("readiness checks Supabase database and the private uploads bucket without writing data", async (t) => {
  const values = {
    MEDIA_STORAGE_PROVIDER: "supabase",
    NEXT_PUBLIC_SUPABASE_URL: "https://readiness-test.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "test-only-service-role",
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let databaseStatus = 200;
  let storageStatus = 200;
  const calls: Array<{ method: string; path: string }> = [];

  Object.assign(process.env, values);
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.hostname, "readiness-test.invalid");
    calls.push({ method: request.method, path: url.pathname });

    if (url.pathname.endsWith("/rest/v1/stores")) {
      assert.equal(request.method, "GET");
      assert.equal(url.searchParams.get("select"), "id");
      assert.equal(url.searchParams.get("limit"), "1");
      return databaseStatus === 200
        ? Response.json([])
        : Response.json({ message: "database unavailable" }, { status: databaseStatus });
    }

    if (url.pathname.endsWith("/storage/v1/bucket")) {
      assert.equal(request.method, "GET");
      return storageStatus === 200
        ? Response.json([{ id: "uploads", name: "uploads", public: false }])
        : Response.json({ message: "storage unavailable" }, { status: storageStatus });
    }

    throw new Error(`Unexpected mocked request: ${request.method} ${url.pathname}`);
  };

  try {
    await t.test("returns ok when both dependencies are reachable", async () => {
      calls.length = 0;
      const response = await GET();
      const result = await response.json();

      assert.equal(response.status, 200);
      assert.equal(result.status, "ok");
      assert.deepEqual(result.dependencies, {
        database: "ok",
        storage: "ok",
        mediaProvider: "supabase",
      });
      assert.ok(calls.some((call) => call.path === "/rest/v1/stores"));
      assert.ok(calls.some((call) => call.path === "/storage/v1/bucket"));
      assert.ok(calls.every((call) => call.method === "GET"));
    });

    await t.test("reports a database failure without exposing provider details", async () => {
      databaseStatus = 503;
      const response = await GET();
      const result = await response.json();

      assert.equal(response.status, 503);
      assert.equal(result.dependencies.database, "error");
      assert.equal(result.dependencies.storage, "ok");
      assert.equal(JSON.stringify(result).includes("database unavailable"), false);
      databaseStatus = 200;
    });

    await t.test("reports a missing or unavailable uploads bucket", async () => {
      storageStatus = 503;
      const response = await GET();
      const result = await response.json();

      assert.equal(response.status, 503);
      assert.equal(result.dependencies.database, "ok");
      assert.equal(result.dependencies.storage, "error");
      assert.equal(JSON.stringify(result).includes("storage unavailable"), false);
      storageStatus = 200;
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
