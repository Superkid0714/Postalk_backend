create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  style_preset text not null default 'menu_highlight'
    check (style_preset in ('menu_highlight', 'clean_poster', 'market_story')),
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

drop trigger if exists generation_jobs_set_updated_at on public.generation_jobs;
create trigger generation_jobs_set_updated_at
before update on public.generation_jobs
for each row
execute function public.set_updated_at();
