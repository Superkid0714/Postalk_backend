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
    check (shot_key in ('menu_board', 'signature_menu', 'flatlay_menu', 'cooking_scene', 'detail_closeup')),
  asset_type text not null
    check (asset_type in ('menu_board', 'food_photo')),
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

drop trigger if exists ad_creation_sessions_set_updated_at on public.ad_creation_sessions;
create trigger ad_creation_sessions_set_updated_at
before update on public.ad_creation_sessions
for each row
execute function public.set_updated_at();
