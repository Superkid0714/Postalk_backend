do $$
declare
  shot_constraint_name text;
  asset_constraint_name text;
begin
  select con.conname
    into shot_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'ad_creation_session_assets'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%shot_key in%';

  if shot_constraint_name is not null then
    execute format(
      'alter table public.ad_creation_session_assets drop constraint %I',
      shot_constraint_name
    );
  end if;

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

  select con.conname
    into asset_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'ad_creation_session_assets'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%asset_type in%';

  if asset_constraint_name is not null then
    execute format(
      'alter table public.ad_creation_session_assets drop constraint %I',
      asset_constraint_name
    );
  end if;

  alter table public.ad_creation_session_assets
    add constraint ad_creation_session_assets_asset_type_check
    check (asset_type in ('menu_board', 'food_photo', 'video_clip'));
end $$;
