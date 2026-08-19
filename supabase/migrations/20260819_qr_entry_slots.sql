create table if not exists public.qr_entry_slots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  slot_number integer not null check (slot_number between 1 and 5),
  slot_key text not null unique,
  label text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists qr_entry_slots_store_id_slot_number_key
  on public.qr_entry_slots (store_id, slot_number);

create index if not exists qr_entry_slots_store_id_idx
  on public.qr_entry_slots (store_id);

drop trigger if exists qr_entry_slots_set_updated_at on public.qr_entry_slots;
create trigger qr_entry_slots_set_updated_at
before update on public.qr_entry_slots
for each row
execute function public.set_updated_at();
