begin;

alter table public.stores add column if not exists guest_session_hash text;
create unique index if not exists stores_guest_session_hash_key
  on public.stores (guest_session_hash);
alter table public.stores drop constraint if exists stores_market_name_store_name_key;
drop index if exists public.stores_market_name_store_name_key;
create unique index stores_market_name_store_name_key
  on public.stores (market_name, store_name) where guest_session_hash is null;

notify pgrst, 'reload schema';
commit;
