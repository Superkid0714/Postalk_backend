create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  role text not null default 'seller' check (role in ('seller', 'admin')),
  name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  market_name text not null,
  store_name text not null,
  owner_name text,
  category text,
  description text,
  latitude double precision,
  longitude double precision,
  location_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists stores_market_name_store_name_key
  on public.stores (market_name, store_name);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  submitter_name text not null,
  submitter_affiliation text,
  qr_payload text,
  store_type text not null,
  target_menu_name text not null,
  price_text text not null,
  appeal_point text not null,
  extra_message text,
  title text,
  caption text,
  hashtags jsonb not null default '[]'::jsonb,
  transcript text,
  ai_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected')),
  admin_notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists submissions_store_id_idx on public.submissions (store_id);
create index if not exists submissions_status_idx on public.submissions (status);
create index if not exists submissions_created_at_idx on public.submissions (created_at desc);

create table if not exists public.submission_assets (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  asset_type text not null
    check (asset_type in ('menu_board', 'food_photo', 'generated_image', 'generated_video', 'video_thumbnail')),
  storage_bucket text not null default 'uploads',
  file_path text not null,
  file_name text,
  mime_type text,
  file_size bigint,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists submission_assets_submission_id_idx
  on public.submission_assets (submission_id);

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  style_preset text not null default 'menu_highlight'
    check (style_preset in ('menu_highlight', 'clean_poster', 'market_story', 'food_card_news')),
  prompt_text text,
  model_name text not null default 'gpt-image-2',
  image_size text not null default '1536x1024',
  quality text not null default 'medium',
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  failure_reason text,
  result_asset_id uuid references public.submission_assets(id) on delete set null,
  result_storage_bucket text,
  result_file_path text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists generation_jobs_submission_id_idx
  on public.generation_jobs (submission_id);

create index if not exists generation_jobs_store_id_idx
  on public.generation_jobs (store_id);

create index if not exists generation_jobs_status_idx
  on public.generation_jobs (status);

create table if not exists public.ad_creation_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  ad_type text not null check (ad_type in ('photo', 'video')),
  intro_text text not null,
  status text not null default 'collecting'
    check (status in ('collecting', 'ready_for_generation', 'generating', 'completed', 'failed')),
  style_preset text not null default 'food_card_news',
  workflow jsonb not null default '{}'::jsonb,
  submission_id uuid references public.submissions(id) on delete set null,
  generation_job_id uuid references public.generation_jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_creation_sessions_store_id_idx
  on public.ad_creation_sessions (store_id);

create index if not exists ad_creation_sessions_status_idx
  on public.ad_creation_sessions (status);

create table if not exists public.ad_creation_session_assets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ad_creation_sessions(id) on delete cascade,
  shot_key text not null
    check (shot_key in (
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
    )),
  asset_type text not null
    check (asset_type in ('menu_board', 'food_photo', 'video_clip')),
  storage_bucket text not null default 'uploads',
  file_path text not null,
  file_name text,
  mime_type text,
  file_size bigint,
  sort_order integer not null default 0,
  review_passed boolean not null default false,
  review_score integer,
  review_summary text,
  review_feedback jsonb not null default '[]'::jsonb,
  review_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ad_creation_session_assets_session_id_idx
  on public.ad_creation_session_assets (session_id);

create table if not exists public.insight_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null unique,
  upload_count integer not null default 0,
  approved_count integer not null default 0,
  published_count integer not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.merchant_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  qr_token text not null unique,
  status text not null default 'ready'
    check (status in ('ready', 'activated', 'disabled')),
  assigned_store_id uuid references public.stores(id) on delete set null,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists merchant_qr_tokens_status_idx
  on public.merchant_qr_tokens (status);

create index if not exists merchant_qr_tokens_assigned_store_id_idx
  on public.merchant_qr_tokens (assigned_store_id);

create table if not exists public.qr_entry_slots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  slot_number integer not null default 1 check (slot_number = 1),
  slot_key text not null unique,
  label text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists qr_entry_slots_store_id_key
  on public.qr_entry_slots (store_id);

create index if not exists qr_entry_slots_store_id_idx
  on public.qr_entry_slots (store_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row
execute function public.set_updated_at();

drop trigger if exists stores_set_updated_at on public.stores;
create trigger stores_set_updated_at
before update on public.stores
for each row
execute function public.set_updated_at();

drop trigger if exists submissions_set_updated_at on public.submissions;
create trigger submissions_set_updated_at
before update on public.submissions
for each row
execute function public.set_updated_at();

drop trigger if exists generation_jobs_set_updated_at on public.generation_jobs;
create trigger generation_jobs_set_updated_at
before update on public.generation_jobs
for each row
execute function public.set_updated_at();

drop trigger if exists ad_creation_sessions_set_updated_at on public.ad_creation_sessions;
create trigger ad_creation_sessions_set_updated_at
before update on public.ad_creation_sessions
for each row
execute function public.set_updated_at();

drop trigger if exists qr_entry_slots_set_updated_at on public.qr_entry_slots;
create trigger qr_entry_slots_set_updated_at
before update on public.qr_entry_slots
for each row
execute function public.set_updated_at();

drop trigger if exists merchant_qr_tokens_set_updated_at on public.merchant_qr_tokens;
create trigger merchant_qr_tokens_set_updated_at
before update on public.merchant_qr_tokens
for each row
execute function public.set_updated_at();
