import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PGlite } from "@electric-sql/pglite";
import { buildSessionWorkflowSeed, getRequestedShot, normalizeAdSessionWorkflow } from "../lib/ad-session.ts";
import { CARDNEWS_SHOTS, CARDNEWS_SHOT_PLAN, renderCardNews } from "../lib/ai/cardnews-service.ts";

test("new sessions request six labeled photos while legacy sessions retain their shot plan", () => {
  const legacy = buildSessionWorkflowSeed("가게 소개", { adType: "photo" });
  assert.equal(legacy.shotPlan?.length, 5);
  const workflow = normalizeAdSessionWorkflow(buildSessionWorkflowSeed("가게 소개", {
    adType: "photo", cardNewsTheme: "christmas", cardNewsStyle: "따뜻하게",
  }));
  assert.equal(workflow.cardNewsTheme, "christmas");
  assert.deepEqual(workflow.shotPlan, CARDNEWS_SHOT_PLAN);
  for (const [currentShotIndex, shot] of CARDNEWS_SHOT_PLAN.entries()) {
    const request = getRequestedShot({ ...workflow, currentShotIndex, requestedShotKey: shot }, "restaurant_food");
    assert.equal(request?.shotKey, shot);
    assert.equal(request?.assetType, "food_photo");
    assert.equal(request?.title, CARDNEWS_SHOTS[shot].title);
  }
});

test("card news adapter signs six inputs and accepts only the expected three output paths", async (t) => {
  const env = { CARDNEWS_API_URL: "http://cardnews.example", CARDNEWS_INTERNAL_API_KEY: "test-key" };
  const old = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const client = { storage: { from: () => ({
    createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/download/${path}` } }),
    createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/upload/${path}` } }),
  }) } } as unknown as SupabaseClient;
  const paths = [1, 2, 3].map(index => `store/submission/generated/job-${index}.png`);
  let wrongOutput = false;
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    assert.equal(url.pathname, "/cardnews/renders");
    assert.equal(new Headers(init.headers).get("x-cardnews-api-key"), "test-key");
    const body = JSON.parse(String(init.body));
    assert.equal(body.theme, "christmas");
    assert.deepEqual(body.photos.map((photo: { role: string }) => photo.role), Object.values(CARDNEWS_SHOTS).map(shot => shot.role));
    assert.deepEqual(body.uploads, paths.map(path => `https://storage.test/upload/${path}`));
    return Response.json({ template: "x1", fallback: true,
      cards: paths.map((path, index) => ({ key: wrongOutput && index === 0 ? "foreign.png" : path, bytes: 10 })) });
  });
  const input = {
    theme: "christmas" as const, direction: "따뜻하게", storeName: "떡집", area: "시장", menuName: "쑥떡", caption: "소개",
    photos: Object.values(CARDNEWS_SHOTS).map(shot => ({ role: shot.role, filePath: `stores/store/food_photo/${shot.role}.jpg` })),
  };
  const ids = { storeId: "store", submissionId: "submission", jobId: "job" };
  assert.equal((await renderCardNews(client, input, ids)).cards.length, 3);
  wrongOutput = true;
  await assert.rejects(renderCardNews(client, input, ids), /invalid results/);
});

test("card news migration keeps legacy shots and adds the six new slots", async () => {
  const db = await PGlite.create();
  try {
    await db.exec("create table ad_creation_session_assets (session_id text default 'session', file_path text, shot_key text not null check (shot_key in ('menu_board', 'video_storefront_sign')));");
    await db.exec("insert into ad_creation_session_assets (shot_key) values ('menu_board'), ('video_storefront_sign');");
    const migration = await readFile(new URL("../supabase/migrations/20261111_cardnews_shots.sql", import.meta.url), "utf8");
    await db.exec(migration);
    for (const shot of CARDNEWS_SHOT_PLAN) {
      await db.query("insert into ad_creation_session_assets (shot_key, file_path) values ($1, $1)", [shot]);
    }
    await db.exec(migration);
    assert.equal((await db.query("select shot_key from ad_creation_session_assets")).rows.length, 8);
    await assert.rejects(db.exec("insert into ad_creation_session_assets (shot_key) values ('unknown')"), /check constraint/);
    await assert.rejects(db.exec("insert into ad_creation_session_assets (shot_key) values ('card_bowl')"), /duplicate key/);
  } finally {
    await db.close();
  }
});
