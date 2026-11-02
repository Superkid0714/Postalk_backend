-- Run ONLY in the newly created postalk-staging project's SQL Editor.
-- This checks emptiness; it cannot identify the dashboard's project for you.
do $$ begin
  if exists(select 1 from pg_tables where schemaname='public') then
    raise exception 'STAGING_NOT_EMPTY: select a new empty test project; do not reset an existing DB';
  end if;
end $$;
select 'EMPTY_PUBLIC_SCHEMA' as result,current_database() as database_name;
