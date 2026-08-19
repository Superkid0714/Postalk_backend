alter table public.stores
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_address text;
