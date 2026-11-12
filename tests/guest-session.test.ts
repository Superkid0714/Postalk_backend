import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { POST as openSession } from "../app/api/guest-session/route.ts";
import { GET as home } from "../app/api/home/route.ts";
import { POST as publish } from "../app/api/publish-requests/route.ts";
import { guestSessionHash } from "../lib/auth/guest-session.ts";

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
  }))).status, 403);

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
