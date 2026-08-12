alter table public.submissions
  add column if not exists store_type text,
  add column if not exists target_menu_name text,
  add column if not exists price_text text,
  add column if not exists appeal_point text,
  add column if not exists extra_message text;

alter table public.submissions
  alter column caption drop not null;

alter table public.submission_assets
  drop constraint if exists submission_assets_asset_type_check;

alter table public.submission_assets
  add constraint submission_assets_asset_type_check
  check (asset_type in ('menu_board', 'food_photo', 'generated_image'));
