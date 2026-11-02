import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

test("normalized workflow preserves existing API writes, scope, files and publication history", async (t) => {
  const db = await PGlite.create();
  const migration = await readFile(new URL("../supabase/migrations/20261102_z_normalized_workflow.sql", import.meta.url), "utf8");
  try {
    await db.exec("create role anon; create role authenticated; create role service_role;");
    // Start from the OLD schema to exercise a genuine populated upgrade.
    const previousSchema = (await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8")).split("-- Normalized workflow with legacy API compatibility.")[0];
    await db.exec(previousSchema.replace("create extension if not exists pgcrypto;", ""));
    const store = (await db.query<{ id: string }>("insert into stores(market_name,store_name) values ('시장','가게') returning id")).rows[0].id;
    const otherStore = (await db.query<{ id: string }>("insert into stores(market_name,store_name) values ('시장','다른 가게') returning id")).rows[0].id;
    const input = { creationId: randomUUID(), format: "card_news", conceptId: "team-concept", storeDescription: "소개", menus: [{ id: "menu-1", name: "음식", description: "설명" }],
      template: { id: "team-template", version: "1", usesSubtitles: false, maxSubtitleChars: 40, scenes: [{ sceneNumber: 1, target: "대표 메뉴", menuId: "menu-1", mediaType: "image", durationSeconds: 3 }] } };
    const source = { id: randomUUID(), store_id: store, creation_id: input.creationId, scene_number: 1, menu_id: "menu-1", media_type: "image", storage_bucket: "uploads", file_path: `stores/${store}/source.png`, mime_type: "image/png", file_size: 100 };
    await db.query("select register_exhibition_upload($1::jsonb)", [JSON.stringify(source)]);
    const create = async () => (await db.query<{ result: { adId: string; jobId: string; reused: boolean } }>("select create_exhibition_ad($1,$2::jsonb,'digest',$3::uuid[],'[]'::jsonb) as result", [store, JSON.stringify(input), [source.id]])).rows[0].result;
    const historical = await create();
    await db.exec(migration);
    await t.test("existing records backfill and compatibility writes are idempotent", async () => {
      assert.equal((await create()).adId, historical.adId);
      const row = (await db.query<{ session_id: string }>("select session_id from contents where id=$1", [historical.adId])).rows[0];
      assert.ok(row.session_id);
      assert.equal((await db.query("select * from scene_media")).rows.length, 1);
      assert.equal((await db.query("select * from concept_versions")).rows.length, 1);
      await db.query("insert into exhibition_templates(store_id,name,store_description,menus) values($1,'입력 양식','소개','[]')", [store]);
      assert.equal((await db.query("select * from input_templates")).rows.length, 1);
      await db.exec(migration);
      assert.equal((await db.query("select * from media_assets")).rows.length, 1);
    });
    await t.test("new creations work through unchanged RPC and create normalized job links", async () => {
      const nextInput = { ...input, creationId: randomUUID() };
      const nextSource = { ...source, id: randomUUID(), creation_id: nextInput.creationId, file_path: `stores/${store}/next.png` };
      await db.query("select register_exhibition_upload($1::jsonb)", [JSON.stringify(nextSource)]);
      const created = (await db.query<{ r: { adId: string; jobId: string } }>("select create_exhibition_ad($1,$2::jsonb,'new-digest',$3::uuid[],'[]') r", [store, JSON.stringify(nextInput), [nextSource.id]])).rows[0].r;
      assert.equal((await db.query<{ content_id: string }>("select content_id from generation_jobs where id=$1", [created.jobId])).rows[0].content_id, created.adId);
    });
    await t.test("immutable concepts and submitted input cannot be rewritten", async () => {
      await assert.rejects(db.query("update concept_versions set renderer_key='changed'"), /IMMUTABLE/);
      await assert.rejects(db.query("select ensure_creation_session($1,$2,$3::jsonb)", [store, input.creationId, JSON.stringify({ ...input, storeDescription: "변경" })]), /CREATION_CONFLICT/);
    });
    await t.test("script requests bind sessions through both old and new table names", async () => {
      const scriptInput = { ...input, creationId: randomUUID(), format: "reels", template: { ...input.template, usesSubtitles: true } };
      const script = (await db.query<{ id: string }>("insert into exhibition_script_jobs(store_id,creation_id,input_digest,input) values($1,$2,'script-digest',$3) returning id", [store, scriptInput.creationId, JSON.stringify(scriptInput)])).rows[0].id;
      const bound = (await db.query<{ session_id: string }>("select session_id from script_jobs where id=$1", [script])).rows[0];
      assert.ok(bound.session_id);
      await db.query("select claim_exhibition_script($1,$2)", [script, randomUUID()]);
      assert.equal((await db.query<{ status: string }>("select status from script_jobs where id=$1", [script])).rows[0].status, "processing");
    });
    await t.test("source and output media enforce store ownership and job identity", async () => {
      const foreign = (await db.query<{ id: string }>("insert into media_assets(store_id,provider,bucket,object_key) values($1,'supabase','uploads','other') returning id", [otherStore])).rows[0].id;
      await assert.rejects(db.query("update scene_media set media_asset_id=$1", [foreign]), /foreign key/);
      await db.query("insert into submission_assets(submission_id,asset_type,storage_bucket,file_path,mime_type,file_size,generation_job_id) values($1,'generated_image','uploads','result.png','image/png',200,$2)", [historical.adId, historical.jobId]);
      const outputs = (await db.query<{ purpose: string }>("select purpose from content_outputs where content_id=$1", [historical.adId])).rows;
      assert.deepEqual(outputs.map(r => r.purpose), ["card_image"]);
      await db.query("update submission_assets set file_size=null,mime_type=null where submission_id=$1", [historical.adId]);
      const knownMedia = (await db.query<{ file_size: number; mime_type: string }>("select file_size,mime_type from media_assets where object_key='result.png'")).rows[0];
      assert.equal(Number(knownMedia.file_size), 200);
      assert.equal(knownMedia.mime_type, "image/png");
      await assert.rejects(db.query("update content_outputs set store_id=$1 where content_id=$2", [otherStore, historical.adId]), /foreign key/);
    });
    await t.test("S3 remap retains a stable media id and changes every source reference", async () => {
      const previous = (await db.query<{ media_asset_id: string }>("select media_asset_id from exhibition_uploads where id=$1", [source.id])).rows[0].media_asset_id;
      await db.query("select remap_media_storage_reference('uploads','s3:postalk-test',$1)", [source.file_path]);
      const media = (await db.query<{ id: string; provider: string; bucket: string }>("select id,provider,bucket from media_assets where id=$1", [previous])).rows[0];
      assert.deepEqual(media, { id: previous, provider: "s3", bucket: "postalk-test" });
      await db.query("select remap_media_storage_reference('s3:postalk-test','uploads',$1)", [source.file_path]);
    });
    await t.test("older workers and metadata-only thumbnails are catalogued on completion", async () => {
      const next = (await db.query<{ id: string; job_id: string }>("select id,job_id from contents where id<>$1 limit 1", [historical.adId])).rows[0];
      const asset = (await db.query<{ id: string }>("insert into submission_assets(submission_id,asset_type,file_path) values($1,'generated_image','legacy-result.png') returning id", [next.id])).rows[0].id;
      await db.query("update generation_jobs set status='completed',result_asset_id=$1,result_storage_bucket='uploads',result_payload=$2 where id=$3", [asset, JSON.stringify({ generatedImages: [{ assetId: asset, filePath: "legacy-result.png" }], thumbnailFilePath: "legacy-thumb.jpg" }), next.job_id]);
      const purposes = (await db.query<{ purpose: string }>("select purpose from content_outputs where content_id=$1 order by purpose", [next.id])).rows.map(row => row.purpose);
      assert.deepEqual(purposes, ["card_image", "thumbnail"]);
    });
    await t.test("publish failures are retained and uncertain outcomes prevent a new attempt", async () => {
      const meta = async (updates: unknown) => db.query("select update_submission_instagram_metadata($1,'instagramPublish',$2::jsonb)", [historical.adId, JSON.stringify(updates)]);
      await meta({ status: "processing", requestedAt: "2026-11-02T01:00:00Z", caption: "첫 캡션", assetIds: ["first"] });
      await meta({ status: "failed", lastError: "확정 실패" });
      await meta({ status: "processing", requestedAt: "2026-11-02T01:01:00Z", caption: "두 번째 캡션", assetIds: ["second"] });
      await meta({ status: "processing", outcomeUnknown: true, lastError: "외부 결과 확인 필요" });
      const attempts = (await db.query<{ status: string; caption_snapshot: string }>("select status,caption_snapshot from publication_attempts where content_id=$1 order by attempt_number", [historical.adId])).rows;
      assert.deepEqual(attempts, [{ status: "failed", caption_snapshot: "첫 캡션" }, { status: "unknown", caption_snapshot: "두 번째 캡션" }]);
      await assert.rejects(meta({ requestedAt: "2026-11-02T01:02:00Z", outcomeUnknown: false }), /unique/);
      await meta({ status: "published", outcomeUnknown: false, publishedMediaId: "ig-id", publishedAt: "2026-11-02T01:03:00Z" });
      assert.equal((await db.query<{ publish_status: string }>("select publish_status from exhibition_ads where id=$1", [historical.adId])).rows[0].publish_status, "published");
    });
    await t.test("usage summaries report bytes without keys and do not delete replaced sources", async () => {
      const usage = (await db.query<{ result: Array<{ provider: string; objects: number; bytes: number }> }>("select media_usage_summary() result")).rows[0].result;
      assert.ok(usage.some(group => group.provider === "supabase" && group.objects > 0));
      assert.ok(!JSON.stringify(usage).includes(source.file_path));
      assert.equal((await db.query("select * from media_assets where object_key=$1", [source.file_path])).rows.length, 1);
    });
    await t.test("uncertain publish reconciliation requires evidence, lease expiry and server access", async () => {
      const next = (await db.query<{ id: string }>("select id from contents where id<>$1 limit 1", [historical.adId])).rows[0].id;
      await db.query("select update_submission_instagram_metadata($1,'instagramPublish',$2)", [next, JSON.stringify({ status: "processing", outcomeUnknown: true, requestedAt: "2026-11-02T01:00:00Z", publishAttemptedAt: new Date().toISOString() })]);
      await assert.rejects(db.query("select reconcile_instagram_publication($1,null,'짧음')", [next]), /EVIDENCE/);
      await assert.rejects(db.query("select reconcile_instagram_publication($1,null,'Instagram 게시 내역을 직접 확인함')", [next]), /PUBLISH_IN_PROGRESS/);
      await db.query("select update_submission_instagram_metadata($1,'instagramPublish','{\"publishAttemptedAt\":\"2020-01-01T00:00:00Z\"}')", [next]);
      await db.query("select reconcile_instagram_publication($1,null,'Instagram 게시 내역을 직접 확인하여 미게시로 확정함')", [next]);
      const record = (await db.query<{ status: string; reconciliation_evidence: string }>("select status,reconciliation_evidence from publication_attempts where content_id=$1", [next])).rows[0];
      assert.equal(record.status, "failed");
      assert.match(record.reconciliation_evidence, /미게시/);
    });
    await t.test("public Supabase clients cannot inspect normalized data or compatibility views", async () => {
      await db.exec("set role anon;");
      for (const table of ["creation_sessions", "creation_scenes", "concept_versions", "media_assets", "scene_media", "contents", "exhibition_ads", "script_jobs", "publication_attempts"]) await assert.rejects(db.query(`select * from ${table}`), /permission denied/);
      await assert.rejects(db.query("select ensure_creation_session($1,$2)", [store, randomUUID()]), /permission denied/);
      await db.exec("reset role;");
    });
  } finally { await db.close(); }
});
