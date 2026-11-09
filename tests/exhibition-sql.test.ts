import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

test("exhibition SQL enforces atomic creation, lifecycle, and shared-account publishing state", async (t) => {
  const db = await PGlite.create();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec((await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8")).replace("create extension if not exists pgcrypto;", ""));
    const storeId = (await db.query<{ id: string }>("insert into stores(market_name,store_name) values ('시장','가게') returning id")).rows[0].id;
    const makeInput = () => ({ creationId: randomUUID(), format: "card_news", conceptId: "external", storeDescription: "가게 설명", menus: [{ id: "menu-1", name: "메뉴", description: "설명" }], template: { id: "external", version: "1", usesSubtitles: false, maxSubtitleChars: 40, scenes: [{ sceneNumber: 1, target: "메뉴", menuId: "menu-1", mediaType: "image", durationSeconds: 3 }] } });
    async function register(input: ReturnType<typeof makeInput>) {
      const asset = { id: randomUUID(), store_id: storeId, creation_id: input.creationId, scene_number: 1, menu_id: "menu-1", media_type: "image", storage_bucket: "uploads", file_path: `stores/${storeId}/food_photo/${randomUUID()}/photo.png`, mime_type: "image/png", file_size: 100 };
      await db.query("select register_exhibition_upload($1::jsonb)", [JSON.stringify(asset)]);
      return asset.id;
    }
    async function create(input: ReturnType<typeof makeInput>, asset: string, digest = "same-input") {
      return (await db.query<{ result: { adId: string; jobId: string; reused: boolean } }>("select create_exhibition_ad($1,$2::jsonb,$3,$4::uuid[],'[]'::jsonb) as result", [storeId, JSON.stringify(input), digest, [asset]])).rows[0].result;
    }
    const input = makeInput(); const asset = await register(input); const ad = await create(input, asset);
    assert.equal((await db.query<{ model_name: string }>("select model_name from generation_jobs where id=$1", [ad.jobId])).rows[0].model_name, "render-exhibition-card");
    await t.test("double-clicks reuse the ad while changed content conflicts", async () => {
      assert.equal((await create(input, asset)).adId, ad.adId);
      assert.equal((await create(input, asset)).reused, true);
      await assert.rejects(create(input, asset, "changed"), /CREATION_CONFLICT/);
      assert.equal((await db.query<{ count: number }>("select count(*)::int as count from generation_jobs")).rows[0].count, 1);
      await assert.rejects(register(input), /CREATION_ALREADY_STARTED/);
    });
    await t.test("foreign-creation materials fail without leaving a partial submission", async () => {
      await assert.rejects(create(makeInput(), asset), /MATERIALS_INVALID/);
      assert.equal((await db.query<{ count: number }>("select count(*)::int as count from submissions")).rows[0].count, 1);
    });
    await t.test("caption editing waits for generation and locks after publishing", async () => {
      const patch = () => db.query("select update_exhibition_caption($1,$2,'새 캡션')", [ad.adId, storeId]);
      await assert.rejects(patch(), /AD_NOT_READY/);
      await db.query("update generation_jobs set status='completed' where id=$1", [ad.jobId]);
      await patch();
      await db.query("select update_submission_instagram_metadata($1,'instagramPublish','{\"status\":\"processing\"}'::jsonb)", [ad.adId]);
      assert.equal((await db.query<{ publish_status: string }>("select publish_status from exhibition_ads where id=$1", [ad.adId])).rows[0].publish_status, "publishing");
      await assert.rejects(patch(), /CAPTION_LOCKED/);
      await assert.rejects(db.query("select delete_exhibition_ad($1,$2)", [ad.adId, storeId]), /PUBLISH_IN_PROGRESS/);
      await db.query("select update_submission_instagram_metadata($1,'instagramPublish','{\"status\":\"published\",\"publishedMediaId\":\"external-id\"}'::jsonb)", [ad.adId]);
      assert.equal((await db.query<{ publish_status: string }>("select publish_status from exhibition_ads where id=$1", [ad.adId])).rows[0].publish_status, "published");
      await assert.rejects(patch(), /CAPTION_LOCKED/);
    });
    await t.test("deletion hides the ad and marks its submission without erasing data", async () => {
      await db.query("select delete_exhibition_ad($1,$2)", [ad.adId, storeId]);
      assert.equal((await db.query<{ count: number }>("select count(*)::int as count from exhibition_ads where deleted_at is null")).rows[0].count, 0);
      assert.equal((await db.query<{ count: number }>("select count(*)::int as count from submissions")).rows[0].count, 1);
      const metadata = (await db.query<{ ai_metadata: { exhibitionDeletedAt?: string } }>("select ai_metadata from submissions where id=$1", [ad.adId])).rows[0].ai_metadata;
      assert.ok(metadata.exhibitionDeletedAt);
      await assert.rejects(create(input, asset), /AD_DELETED/);
    });
    await t.test("failed generation retries keep the same ad and queued deletion cancels it", async () => {
      const next = makeInput(); const nextAd = await create(next, await register(next));
      await db.query("update generation_jobs set status='failed' where id=$1", [nextAd.jobId]);
      await db.query("select retry_exhibition_generation($1,$2)", [nextAd.adId, storeId]);
      assert.equal((await db.query<{ status: string }>("select status from generation_jobs where id=$1", [nextAd.jobId])).rows[0].status, "queued");
      await db.query("select delete_exhibition_ad($1,$2)", [nextAd.adId, storeId]);
      assert.equal((await db.query<{ status: string }>("select status from generation_jobs where id=$1", [nextAd.jobId])).rows[0].status, "failed");
    });
    await t.test("anonymous clients cannot read exhibition records or create ads directly", async () => {
      await db.exec("set role anon;");
      await assert.rejects(db.query("select * from exhibition_ads"), /permission denied/);
      await assert.rejects(db.query("select * from generation_jobs"), /permission denied/);
      await assert.rejects(create(makeInput(), asset), /permission denied/);
      await db.exec("reset role;");
    });
  } finally { await db.close(); }
});
