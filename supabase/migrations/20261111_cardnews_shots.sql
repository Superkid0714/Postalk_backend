begin;

alter table public.ad_creation_session_assets
  drop constraint if exists ad_creation_session_assets_shot_key_check;
alter table public.ad_creation_session_assets
  add constraint ad_creation_session_assets_shot_key_check check (shot_key in (
    'menu_board', 'signature_menu', 'flatlay_menu', 'cooking_scene', 'detail_closeup',
    'video_storefront_sign', 'video_storefront_entry', 'video_menu_board', 'video_signature_menu',
    'video_signature_interaction', 'video_cooking_scene', 'video_side_menu', 'video_side_menu_interaction',
    'card_bowl', 'card_zoom', 'card_food1', 'card_food2', 'card_store1', 'card_store2'
  ));

create unique index if not exists cardnews_session_shot_key
  on public.ad_creation_session_assets (session_id, shot_key)
  where shot_key in ('card_bowl', 'card_zoom', 'card_food1', 'card_food2', 'card_store1', 'card_store2');
create unique index if not exists cardnews_session_photo_path
  on public.ad_creation_session_assets (session_id, file_path)
  where shot_key in ('card_bowl', 'card_zoom', 'card_food1', 'card_food2', 'card_store1', 'card_store2');

commit;
