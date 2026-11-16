import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as startSession } from "../app/api/ad-sessions/start/route.ts";
import type { AdSessionWorkflow } from "../lib/ad-session.ts";
import { CARDNEWS_SHOT_PLAN } from "../lib/ai/cardnews-service.ts";
import { REELS_SHOT_PLAN } from "../lib/ai/reels.ts";

const STORE = "11111111-1111-4111-8111-111111111111";

test("session start keeps photo capture independent of the enabled reels service", async (t) => {
  const env = {
    GUEST_CREATION_ENABLED: "true",
    NEXT_PUBLIC_SUPABASE_URL: "https://session-test.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "local-test-key",
    CARDNEWS_API_URL: "https://cardnews-test.invalid",
    REELS_API_URL: "https://reels-test.invalid",
  };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  let workflow: AdSessionWorkflow | undefined;
  t.mock.method(globalThis, "fetch", async (input: URL | string, init: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.origin, env.NEXT_PUBLIC_SUPABASE_URL);
    if (url.pathname === "/rest/v1/stores") {
      const store = { id: STORE, store_name: "분식집", market_name: "시장", category: "food", owner_name: null, description: null };
      return Response.json(url.searchParams.has("guest_session_hash") ? [store] : store);
    }
    assert.equal(url.pathname, "/rest/v1/ad_creation_sessions");
    assert.equal(init.method, "POST");
    workflow = JSON.parse(String(init.body)).workflow;
    return Response.json({ id: STORE, status: "collecting", style_preset: "food_card_news", created_at: "2026-11-16T00:00:00Z" });
  });

  async function start(adType: "photo" | "video", reelsMenus?: Array<{ name: string }>) {
    workflow = undefined;
    const response = await startSession(new NextRequest("http://localhost/api/ad-sessions/start", {
      method: "POST",
      headers: { "x-guest-session": "a".repeat(64) },
      body: JSON.stringify({ storeId: STORE, adType, menuIntro: "떡볶이", storeSpecialty: "직접 만든 양념", reelsMenus }),
    }));
    assert.equal(response.status, 201);
    return (await response.json()).data;
  }

  const photo = await start("photo");
  assert.equal(photo.currentRequest.shotKey, "card_bowl");
  assert.equal(photo.currentRequest.assetType, "food_photo");
  assert.deepEqual(workflow?.shotPlan, CARDNEWS_SHOT_PLAN);
  assert.equal(workflow?.reelsMenus, undefined);

  const video = await start("video");
  assert.equal(video.currentRequest.shotKey, "video_storefront_sign");
  assert.equal(video.currentRequest.assetType, "video_clip");
  assert.deepEqual(workflow?.shotPlan, REELS_SHOT_PLAN);
  assert.deepEqual(workflow?.reelsMenus, [{ name: "떡볶이" }]);

  await start("video", [{ name: "떡볶이" }, { name: "순대" }, { name: "튀김" }]);
  assert.equal(workflow?.shotPlan?.length, 8);

  process.env.REELS_API_URL = "";
  await start("photo");
  assert.deepEqual(workflow?.shotPlan, CARDNEWS_SHOT_PLAN);
  await start("video");
  assert.deepEqual(workflow?.shotPlan, REELS_SHOT_PLAN);
});
