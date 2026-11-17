import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { POST as openSession } from "../app/api/guest-session/route.ts";
import { GET as home } from "../app/api/home/route.ts";
import { POST as publish } from "../app/api/publish-requests/route.ts";
import { createClient } from "@supabase/supabase-js";
import { openGuestStore, guestSessionHash } from "../lib/auth/guest-session.ts";

const FIRST_STORE = "11111111-1111-4111-8111-111111111111";
const SECOND_STORE = "22222222-2222-4222-8222-222222222222";
const FIRST_KEY = "a".repeat(64);
const SECOND_KEY = "b".repeat(64);

test("guest access reopens the same workspace and enforces store and publishing permissions", async (t) => {
  const stores = new Map<string, { id: string; store_name: string; market_name: string }>();
  t.mock.method(globalThis, "fetch", async (input: URL | string, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/rest/v1/submissions") return Response.json([]);
    assert.equal(url.pathname, "/rest/v1/stores");
    const filter = url.searchParams.get("guest_session_hash")?.slice(3) ?? "";
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body));
      const hash = body.guest_session_hash;
      assert.ok(hash === guestSessionHash(FIRST_KEY) || hash === guestSessionHash(SECOND_KEY));
      assert.equal(url.searchParams.get("on_conflict"), "guest_session_hash");
      if (!stores.has(hash)) stores.set(hash, {
        id: stores.size === 0 ? FIRST_STORE : SECOND_STORE,
        store_name: body.store_name,
        market_name: body.market_name,
      });
      return new Response(null, { status: 201 });
    }
    const store = stores.get(filter) ?? [...stores.values()].find(row => `eq.${row.id}` === url.searchParams.get("id"));
    if (init.method === "PATCH" && store) Object.assign(store, JSON.parse(String(init.body)));
    if (filter) return Response.json(store ? [store] : []);
    return Response.json(store ?? null);
  });
  const env = {
    GUEST_CREATION_ENABLED: process.env.GUEST_CREATION_ENABLED,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  Object.assign(process.env, {
    GUEST_CREATION_ENABLED: "true",
    NEXT_PUBLIC_SUPABASE_URL: "https://guest-test.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "local-test-key",
  });
  t.after(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function entry(key: string, body?: string) {
    return openSession(new Request("http://localhost/api/guest-session", {
      method: "POST", headers: { "x-guest-session": key }, body,
    }));
  }

  assert.equal((await entry("invalid")).status, 400);
  assert.equal((await entry(FIRST_KEY, JSON.stringify({ storeName: [] }))).status, 400);
  const first = await entry(FIRST_KEY);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.deepEqual((await first.json()).data, { storeId: FIRST_STORE, canPublish: false });
  // A reverse proxy can give a bodyless POST a non-null, empty request stream.
  const emptyBody = await entry(FIRST_KEY, "");
  assert.equal(emptyBody.status, 200);
  assert.equal((await emptyBody.json()).data.storeId, FIRST_STORE);
  assert.equal((await entry(FIRST_KEY, "{")).status, 400);
  assert.deepEqual((await (await entry(FIRST_KEY, JSON.stringify({ storeName: "분식집" }))).json()).data, {
    storeId: FIRST_STORE, canPublish: false,
  });
  assert.equal((await (await entry(SECOND_KEY)).json()).data.storeId, SECOND_STORE);
  assert.equal((await (await entry(FIRST_KEY)).json()).data.storeId, FIRST_STORE);
  assert.equal(stores.size, 2);

  const headers = { "x-guest-session": FIRST_KEY };
  const ownHome = await home(new NextRequest(`http://localhost/api/home?storeId=${FIRST_STORE}`, { headers }));
  assert.equal(ownHome.status, 200);
  assert.equal((await ownHome.json()).data.summary.storeName, "분식집");
  assert.equal((await home(new NextRequest(`http://localhost/api/home?storeId=${SECOND_STORE}`, { headers }))).status, 403);
  assert.equal((await publish(new Request("http://localhost/api/publish-requests", {
    method: "POST", headers, body: JSON.stringify({ submissionId: FIRST_STORE }),
  }))).status, 404);

  process.env.GUEST_CREATION_ENABLED = "false";
  assert.equal((await entry(FIRST_KEY)).status, 404);
  assert.equal((await home(new NextRequest(`http://localhost/api/home?storeId=${FIRST_STORE}`, { headers }))).status, 401);
});

test("guest migration preserves merchant name uniqueness and permits separate guest workspaces", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      create table stores (id uuid primary key default gen_random_uuid(), market_name text not null, store_name text not null);
      create unique index stores_market_name_store_name_key on stores (market_name, store_name);
      insert into stores (market_name, store_name) values ('market', 'store');
    `);
    const migration = await readFile(new URL("../supabase/migrations/20261111_guest_sessions.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(`
      insert into stores (market_name, store_name, guest_session_hash) values
      ('market', 'store', 'first'), ('market', 'store', 'second');
      insert into stores (market_name, store_name, guest_session_hash) values
      ('market', 'store', 'first') on conflict (guest_session_hash) do nothing;
    `);
    await db.exec(migration);
    assert.equal((await db.query("select id from stores")).rows.length, 3);
    await assert.rejects(db.exec("insert into stores (market_name, store_name) values ('market', 'store')"), /duplicate key/);
  } finally {
    await db.close();
  }
});


test("guest database diagnostics identify the failed step without logging private values", async t => {
  const client = createClient("https://guest-diagnostics.invalid", "test-service-key");
  const privateValue = "private-session-hash";
  const records: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { records.push(args); });
  t.mock.method(console, "warn", () => {});
  let failure: "insert" | "update" | "lookup" | "empty" | "transport" = "insert";
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    if (failure === "transport") throw new TypeError("fetch failed: " + privateValue);
    const operation = init?.method === "POST" ? "insert" : init?.method === "PATCH" ? "update" : "lookup";
    if (operation === failure) return Response.json({
      code: "TEST_DATABASE_ERROR", message: privateValue, details: privateValue,
    }, { status: 503 });
    if (operation === "insert") return new Response(null, { status: 201 });
    return Response.json([]);
  });
  for (const step of ["insert", "update", "lookup", "empty", "transport"] as const) {
    failure = step;
    records.length = 0;
    const result = await openGuestStore(client, privateValue, step === "update" ? { storeName: "private-store-name" } : {});
    assert.equal(records.length, 1);
    const info = records[0][1];
    assert.deepEqual(info, {
      operation: step === "empty" ? "lookup" : step === "transport" ? "insert" : step,
      status: step === "empty" ? 200 : step === "transport" ? 0 : 503,
      code: step === "empty" || step === "transport" ? null : "TEST_DATABASE_ERROR",
      emptyResult: step === "empty",
    });
    assert.ok(!JSON.stringify(records).includes(privateValue));
    assert.ok(!JSON.stringify(records).includes("private-store-name"));
    assert.ok(result.error || !result.data);
  }
});


test("guest opening recovers transient failures without duplicating a committed workspace", async t => {
  t.mock.method(console, "warn", () => {});
  const client = createClient("https://guest-recovery.invalid", "test-key");
  let mode = "lost-insert";
  let failed = false;
  const stores = new Map<string, { id: string; store_name: string }>();
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const operation = init?.method === "POST" ? "insert" : init?.method === "PATCH" ? "update" : "lookup";
    if (operation === "insert") {
      writes++;
      const body = JSON.parse(String(init?.body));
      if (!stores.has(body.guest_session_hash)) stores.set(body.guest_session_hash, { id: FIRST_STORE, store_name: body.store_name });
    }
    if (!failed && mode === "lost-insert" && operation === "insert") {
      failed = true;
      throw new TypeError("fetch failed after commit");
    }
    if (!failed && mode === "update-503" && operation === "update") {
      failed = true;
      return Response.json({ code: "PGRST002", message: "unavailable" }, { status: 503 });
    }
    if (!failed && mode === "empty-lookup" && operation === "lookup") {
      failed = true;
      return Response.json([]);
    }
    if (operation === "insert") return new Response(null, { status: 201 });
    const row = stores.get(url.searchParams.get("guest_session_hash")!.slice(3))!;
    if (operation === "update") Object.assign(row, JSON.parse(String(init?.body)));
    return Response.json([{ id: row.id }]);
  });
  for (const scenario of ["lost-insert", "update-503", "empty-lookup"]) {
    mode = scenario; failed = false; writes = 0;
    const result = await openGuestStore(client, FIRST_KEY, scenario === "update-503" ? { storeName: "updated" } : {});
    assert.equal(result.error, null);
    assert.equal(result.data?.id, FIRST_STORE);
    assert.equal(writes, 2);
    assert.equal(stores.size, 1);
  }
  assert.equal(stores.get(FIRST_KEY)?.store_name, "updated");
});

test("guest opening bounds retries and does not retry permanent database failures", async t => {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  const client = createClient("https://guest-failures.invalid", "test-key");
  let calls = 0;
  let status = 503;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ code: status === 403 ? "42501" : "PGRST002", message: "failure" }, { status });
  });
  const failed = await openGuestStore(client, FIRST_KEY, {});
  assert.equal(failed.error?.code, "PGRST002");
  assert.equal(calls, 3);
  status = 403; calls = 0;
  const denied = await openGuestStore(client, FIRST_KEY, {});
  assert.equal(denied.error?.code, "42501");
  assert.equal(calls, 1);
});
