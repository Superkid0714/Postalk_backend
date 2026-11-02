import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const sql = (path: string) => readFile(new URL(`../supabase/${path}`, import.meta.url), "utf8");
test("staging SQL checks installation and protects legacy QR tables even with automatic client grants", async (t) => {
  const db = await PGlite.create();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; alter default privileges in schema public grant all on tables to anon,authenticated;");
    await db.exec(await sql("staging/00-check-empty.sql"));
    const schema = (await sql("schema.sql")).replace("create extension if not exists pgcrypto;", "");
    await db.exec(schema.split("-- Server-only access for legacy tables.")[0]);
    // Reproduce inherited Supabase grants that generic PostgreSQL unit tests miss.
    await db.exec("insert into merchant_qr_tokens(qr_token) values('test-only-inactive-token'); set role anon;");
    assert.equal((await db.query("select id from merchant_qr_tokens")).rows.length, 1);
    await db.exec("reset role;");
    const lockdown = await sql("migrations/20261102_zz_server_only_tables.sql");
    await db.exec(lockdown);
    await db.exec(lockdown);
    const tables = (await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
    await t.test("all application tables deny direct client reads and writes", async () => {
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`set role ${role};`);
        for (const { tablename } of tables) {
          await assert.rejects(db.query(`select * from public.${tablename}`), /permission denied/);
          await assert.rejects(db.query(`insert into public.${tablename} default values`), /permission denied/);
          await assert.rejects(db.query(`delete from public.${tablename} where false`), /permission denied/);
        }
        await db.exec("reset role;");
      }
    });
    await t.test("service role retains access and every table has RLS", async () => {
      assert.equal((await db.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity")).rows.length, 0);
      await db.exec("set role service_role;");
      for (const { tablename } of tables) await db.query(`select * from public.${tablename} limit 0`);
      await db.exec("reset role;");
    });
    await t.test("empty-project guard refuses an existing project without resetting it", async () => {
      await assert.rejects(db.exec(await sql("staging/00-check-empty.sql")), /STAGING_NOT_EMPTY/);
      assert.equal((await db.query("select * from merchant_qr_tokens")).rows.length, 1);
    });
    await t.test("SQL Editor verification exercises a complete DB workflow and rolls fixtures back", async () => {
      const result = await db.exec(await sql("staging/02-verify.sql"));
      assert.ok(JSON.stringify(result).includes("PASS:"));
      for (const table of ["stores", "contents", "creation_sessions", "generation_jobs", "media_assets"]) assert.equal((await db.query(`select * from ${table}`)).rows.length, 0);
    });
    await t.test("private upload bucket setup refuses to modify an existing bucket", async () => {
      // Model the bucket metadata only; this does not test live Storage.
      await db.exec("create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
      const setup = await sql("staging/03-private-storage.sql");
      await db.exec(setup);
      assert.equal((await db.query<{ public: boolean }>("select public from storage.buckets where id='uploads'")).rows[0].public, false);
      await assert.rejects(db.exec(setup), /BUCKET_ALREADY_EXISTS/);
      await db.exec("rollback;");
      assert.equal((await db.query("select * from storage.buckets")).rows.length, 1);
    });
  } finally { await db.close(); }
});
