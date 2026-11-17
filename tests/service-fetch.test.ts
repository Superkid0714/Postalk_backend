import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createServiceFetch } from "../lib/supabase/service-fetch";

test("service SDK sends opaque secret keys through apikey without a JWT Bearer fallback", async t => {
  const key = "sb_secret_test-only";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    calls++;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("apikey"), key);
    assert.equal(headers.get("authorization"), null);
    return Response.json([{ id: "test" }]);
  });
  const client = createClient("https://service-headers.invalid", key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createServiceFetch(key) },
  });
  assert.equal((await client.from("stores").select("id")).error, null);
  assert.equal(calls, 1);
});

test("service fetch preserves legacy JWTs, explicit user tokens, bodies, and abort signals", async t => {
  const received: RequestInit[] = [];
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    received.push(init!);
    return Response.json([]);
  });
  const legacy = "legacy-jwt";
  const opaque = "sb_secret_test-only";
  const controller = new AbortController();
  const headers = new Headers({ apikey: opaque, authorization: `Bearer ${opaque}` });
  await createServiceFetch(opaque)("https://service-headers.invalid", {
    method: "POST", body: "{}", signal: controller.signal, headers,
  });
  assert.equal(headers.get("authorization"), `Bearer ${opaque}`, "caller headers must not be mutated");
  assert.equal(received[0].method, "POST");
  assert.equal(received[0].body, "{}");
  assert.equal(received[0].signal, controller.signal);
  assert.equal(new Headers(received[0].headers).get("authorization"), null);
  await createServiceFetch(legacy)("https://service-headers.invalid", { headers: { authorization: `Bearer ${legacy}` } });
  assert.equal(new Headers(received[1].headers).get("authorization"), `Bearer ${legacy}`);
  await createServiceFetch(opaque)("https://service-headers.invalid", { headers: { authorization: "Bearer explicit-user-jwt" } });
  assert.equal(new Headers(received[2].headers).get("authorization"), "Bearer explicit-user-jwt");
});
