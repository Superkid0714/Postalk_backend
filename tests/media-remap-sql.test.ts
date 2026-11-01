import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("real PostgreSQL media remap is atomic, reversible, scoped, and server-only", async (t) => {
  const db = await PGlite.create();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role;");
    // gen_random_uuid is built into PostgreSQL; Supabase's extension declaration is unnecessary here.
    const schema = (await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"))
      .replace("create extension if not exists pgcrypto;", "");
    await db.exec(schema);
    // Exercise the deployable migration too, including its idempotent replacement and grants.
    await db.exec(await readFile(new URL("../supabase/migrations/20261102_media_storage_remap.sql", import.meta.url), "utf8"));
    const store = (await db.query<{ id: string }>("insert into stores(market_name, store_name) values ('test market','test store') returning id")).rows[0].id;
    const key = "stores/test/food_photo/object/image.png";
    const metadata = { videoWorkflow: { resultStorageBucket: "uploads", resultFilePath: key, caption: "preserve" } };
    const submission = (await db.query<{ id: string }>(
      "insert into submissions(store_id,submitter_name,store_type,target_menu_name,price_text,appeal_point,ai_metadata) values ($1,'seller','food','menu','1000','fresh',$2::jsonb) returning id",
      [store, JSON.stringify(metadata)],
    )).rows[0].id;
    await db.query("insert into submission_assets(submission_id,asset_type,storage_bucket,file_path) values ($1,'food_photo','uploads',$2),($1,'food_photo','uploads','unrelated.png')", [submission, key]);
    const session = (await db.query<{ id: string }>("insert into ad_creation_sessions(store_id,ad_type,intro_text) values ($1,'photo','intro') returning id", [store])).rows[0].id;
    await db.query("insert into ad_creation_session_assets(session_id,shot_key,asset_type,storage_bucket,file_path) values ($1,'signature_menu','food_photo','uploads',$2)", [session, key]);
    const sources = { sourceVideos: [{ storageBucket: "uploads", filePath: key, order: 1 }, { storageBucket: "uploads", filePath: "unrelated.png", order: 2 }] };
    await db.query("insert into generation_jobs(submission_id,store_id,status,result_storage_bucket,result_file_path,request_payload) values ($1,$2,'completed','uploads',$3,$4::jsonb)", [submission, store, key, JSON.stringify(sources)]);

    async function remap(from: string, to: string) { return db.query("select remap_media_storage_reference($1,$2,$3)", [from, to, key]); }
    async function assertReferences(bucket: string) {
      assert.equal((await db.query<{ storage_bucket: string }>("select storage_bucket from submission_assets where file_path=$1", [key])).rows[0].storage_bucket, bucket);
      assert.equal((await db.query<{ storage_bucket: string }>("select storage_bucket from ad_creation_session_assets")).rows[0].storage_bucket, bucket);
      const job = (await db.query<{ result_storage_bucket: string; request_payload: typeof sources }>("select result_storage_bucket,request_payload from generation_jobs")).rows[0];
      assert.equal(job.result_storage_bucket, bucket);
      assert.equal(job.request_payload.sourceVideos[0].storageBucket, bucket);
      assert.equal(job.request_payload.sourceVideos[1].storageBucket, "uploads");
      assert.equal(job.request_payload.sourceVideos[0].order, 1);
      const row = (await db.query<{ ai_metadata: typeof metadata; status: string }>("select ai_metadata,status from submissions")).rows[0];
      assert.equal(row.ai_metadata.videoWorkflow.resultStorageBucket, bucket);
      assert.equal(row.ai_metadata.videoWorkflow.caption, "preserve");
      assert.equal(row.status, "draft");
      assert.equal((await db.query<{ storage_bucket: string }>("select storage_bucket from submission_assets where file_path='unrelated.png'")).rows[0].storage_bucket, "uploads");
    }

    await t.test("promotion changes all five reference locations but not unrelated files or metadata", async () => {
      await remap("uploads", "s3:postalk-media-test");
      await assertReferences("s3:postalk-media-test");
      await remap("uploads", "s3:postalk-media-test"); // Repeat is harmless.
      await assertReferences("s3:postalk-media-test");
    });
    await t.test("rollback restores preserved source references", async () => {
      await remap("s3:postalk-media-test", "uploads");
      await assertReferences("uploads");
    });
    await t.test("a mid-remap failure rolls back earlier table updates", async () => {
      await db.exec("create function fail_remap_test() returns trigger language plpgsql as $$ begin raise exception 'simulated write failure'; end $$; create trigger fail_remap_test before update on generation_jobs for each row execute function fail_remap_test();");
      await assert.rejects(remap("uploads", "s3:postalk-media-test"), /simulated write failure/);
      await assertReferences("uploads");
      await db.exec("drop trigger fail_remap_test on generation_jobs;");
    });
    await t.test("anonymous clients cannot invoke the remap", async () => {
      await db.exec("set role anon;");
      await assert.rejects(remap("uploads", "s3:postalk-media-test"), /permission denied/);
      await db.exec("reset role;");
    });
  } finally { await db.close(); }
});
