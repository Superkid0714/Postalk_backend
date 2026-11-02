do $$
declare
  constraint_name text;
begin
  -- PostgreSQL deparses IN checks as = ANY(...), so text matching "in"
  -- misses existing constraints and fails when adding the same name again.
  for constraint_name in select con.conname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'ad_creation_session_assets'
    and con.contype = 'c'
    and exists(select 1 from pg_attribute a where a.attrelid=con.conrelid and a.attname='shot_key' and a.attnum=any(con.conkey)) loop
    execute format(
      'alter table public.ad_creation_session_assets drop constraint %I',
      constraint_name
    );
  end loop;

  alter table public.ad_creation_session_assets
    add constraint ad_creation_session_assets_shot_key_check
    check (
      shot_key in (
        'menu_board',
        'signature_menu',
        'flatlay_menu',
        'cooking_scene',
        'detail_closeup',
        'video_storefront_sign',
        'video_storefront_entry',
        'video_menu_board',
        'video_signature_menu',
        'video_signature_interaction',
        'video_cooking_scene',
        'video_side_menu',
        'video_side_menu_interaction'
      )
    );

  for constraint_name in select con.conname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'ad_creation_session_assets'
    and con.contype = 'c'
    and exists(select 1 from pg_attribute a where a.attrelid=con.conrelid and a.attname='asset_type' and a.attnum=any(con.conkey)) loop
    execute format(
      'alter table public.ad_creation_session_assets drop constraint %I',
      constraint_name
    );
  end loop;

  alter table public.ad_creation_session_assets
    add constraint ad_creation_session_assets_asset_type_check
    check (asset_type in ('menu_board', 'food_photo', 'video_clip'));
end $$;
