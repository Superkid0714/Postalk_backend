-- All application DB access goes through server APIs using service_role.
-- Explicit grants also work on projects without automatic public-schema grants.
begin;
do $$ declare table_name text; begin
  foreach table_name in array array[
    'users','stores','ad_creation_sessions','ad_creation_session_assets','merchant_qr_tokens','qr_entry_slots'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from public,anon,authenticated',table_name);
    execute format('grant all on public.%I to service_role',table_name);
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
