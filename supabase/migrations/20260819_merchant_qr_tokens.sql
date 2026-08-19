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

drop trigger if exists merchant_qr_tokens_set_updated_at on public.merchant_qr_tokens;
create trigger merchant_qr_tokens_set_updated_at
before update on public.merchant_qr_tokens
for each row
execute function public.set_updated_at();
