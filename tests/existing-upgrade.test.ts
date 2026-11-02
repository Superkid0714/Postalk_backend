import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('atomic legacy upgrade preserves records, historical labels and provider requests', async () => {
  const db = await PGlite.create();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    const schema = (await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8')).split('create table if not exists public.generation_job_leases')[0];
    await db.exec(schema.replace('create extension if not exists pgcrypto;',''));
    await db.exec(`alter table submissions drop constraint submissions_status_check;
      alter table submissions add constraint submissions_status_check check(status in ('pending_review','approved','rejected'));
      alter table submissions alter column status set default 'pending_review';
      alter table ad_creation_session_assets drop constraint ad_creation_session_assets_asset_type_check;
      alter table ad_creation_session_assets add constraint ad_creation_session_assets_asset_type_check check(asset_type in ('menu_board','food_photo'));
      alter table ad_creation_session_assets drop constraint ad_creation_session_assets_shot_key_check;
      alter table ad_creation_session_assets add constraint ad_creation_session_assets_shot_key_check check(shot_key in ('menu_board','signature_menu'));
      create table public.ai_jobs(id int primary key);`);
    const store = (await db.query<{id:string}>("insert into stores(market_name,store_name) values('test','test') returning id")).rows[0].id;
    const submission = (await db.query<{id:string}>(`insert into submissions(store_id,submitter_name,store_type,target_menu_name,price_text,appeal_point,status,caption,ai_metadata)
      values($1,'test','test','test','test','test','approved','keep caption','{"custom":"keep","adWorkflow":{"publishRequestStatus":"approved"}}') returning id`,[store])).rows[0].id;
    await db.query(`insert into generation_jobs(submission_id,store_id,status,updated_at,request_payload,result_payload)
      values($1,$2,'processing',now()-interval '30 days','{"providerOperationId":"keep"}','{"providerData":"keep"}')`,[submission,store]);
    // Exercise the exact named IN checks that PostgreSQL deparses as = ANY.
    const video = await readFile(new URL('../supabase/migrations/20260819_ad_creation_session_video_assets.sql',import.meta.url),'utf8');
    await db.exec(video); await db.exec(video);
    const { buildExistingUpgrade } = await import('../supabase/operations/build-existing-upgrade.mjs');
    await db.exec(await buildExistingUpgrade());
    const row = (await db.query<{status:string;caption:string;ai_metadata:Record<string,unknown>}>('select status,caption,ai_metadata from submissions')).rows[0];
    assert.equal(row.status,'draft'); assert.equal(row.caption,'keep caption');
    assert.equal(row.ai_metadata.custom,'keep');
    assert.equal((row.ai_metadata.merchantWorkflowMigration as {previousStatus:string}).previousStatus,'approved');
    const job = (await db.query<{status:string;request_payload:unknown;result_payload:{providerData:string;legacyRecoveryState:{previousStatus:string}}}>('select status,request_payload,result_payload from generation_jobs')).rows[0];
    assert.equal(job.status,'failed'); assert.deepEqual(job.request_payload,{providerOperationId:'keep'});
    assert.equal(job.result_payload.providerData,'keep'); assert.equal(job.result_payload.legacyRecoveryState.previousStatus,'processing');
    await db.exec(await readFile(new URL('../supabase/staging/02-verify.sql',import.meta.url),'utf8'));
    assert.equal((await db.query('select * from stores')).rows.length,1);
    await assert.rejects(db.exec(await buildExistingUpgrade()),/ALREADY_UPGRADED/);
    await db.exec('rollback;');
  } finally { await db.close(); }
});

test('legacy upgrade rejects recent paid work without modifying its state',async()=>{
  const db=await PGlite.create();
  try {
    await db.exec(`create table generation_jobs(status text,updated_at timestamptz); insert into generation_jobs values('processing',now());
      create table submissions(ai_metadata jsonb);`);
    const prepare=await readFile(new URL('../supabase/operations/prepare-existing-upgrade.sql',import.meta.url),'utf8');
    await assert.rejects(db.exec(prepare),/RECENT_GENERATION_WORK/);
    assert.equal((await db.query<{status:string}>('select status from generation_jobs')).rows[0].status,'processing');
  } finally {await db.close();}
});
