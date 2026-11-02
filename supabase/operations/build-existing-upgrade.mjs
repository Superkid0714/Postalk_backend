import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function buildExistingUpgrade() {
  const read = name => readFile(new URL(name, import.meta.url), 'utf8');
  const names = ['20260819_store_location_fields.sql','20260819_ad_creation_session_video_assets.sql',
    '20261102_generation_job_leases.sql','20261102_remove_review_workflow.sql','20261102_session_draft_merge.sql',
    '20261102_submission_publish_leases.sql','20261102_media_storage_remap.sql','20261102_exhibition_flow.sql',
    '20261102_z_normalized_workflow.sql','20261102_zz_server_only_tables.sql'];
  const fragments = await Promise.all(names.map(async name => `-- ${name}\n${(await read('../migrations/'+name)).replace(/^\s*(begin|commit);\s*$/gmi,'')}`));
  return `-- Existing populated Postalk project: one atomic upgrade, no table or file deletion.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $$ begin
 if to_regclass('public.contents') is not null then raise exception 'ALREADY_UPGRADED: do not rerun this legacy-only bundle'; end if;
end $$;
lock table public.users,public.stores,public.submissions,public.submission_assets,public.generation_jobs,
 public.ad_creation_sessions,public.ad_creation_session_assets,public.merchant_qr_tokens,public.qr_entry_slots in share row exclusive mode;
create temporary table postalk_previous_counts(table_name text primary key, row_count bigint) on commit drop;
do $$ declare r record; n bigint; begin
 for r in select tablename from pg_tables where schemaname='public' loop
  execute format('select count(*) from public.%I',r.tablename) into n;
  insert into postalk_previous_counts values(r.tablename,n);
 end loop;
 if exists(select 1 from public.users where role<>'seller') then raise exception 'NON_SELLER_USER: inspect before removing admin role'; end if;
end $$;
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check(role='seller');
${await read('prepare-existing-upgrade.sql')}
${fragments.join('\n')}
-- Preserve unused legacy tables while restricting direct browser access.
do $$ declare name text; r record; n bigint; begin
 foreach name in array array['ai_jobs','uploads','insight_snapshots','posts','publish_logs'] loop
  if to_regclass('public.'||name) is not null then
   execute format('alter table public.%I enable row level security',name);
   execute format('revoke all on public.%I from public,anon,authenticated',name);
   execute format('grant all on public.%I to service_role',name);
  end if;
 end loop;
 for r in select * from postalk_previous_counts loop
  execute format('select count(*) from public.%I',r.table_name) into n;
  if n<>r.row_count then raise exception 'ROW_COUNT_CHANGED: %',r.table_name; end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
select 'UPGRADE_OK: original row counts preserved' as result;
`;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(!process.argv[2]) throw new Error('Usage: node supabase/operations/build-existing-upgrade.mjs <output.sql>');
  await writeFile(process.argv[2],await buildExistingUpgrade());
}
