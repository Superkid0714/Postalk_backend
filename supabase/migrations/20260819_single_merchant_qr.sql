with ranked_qr as (
  select
    id,
    row_number() over (
      partition by store_id
      order by slot_number asc, created_at asc, id asc
    ) as row_rank
  from public.qr_entry_slots
)
delete from public.qr_entry_slots
where id in (
  select id
  from ranked_qr
  where row_rank > 1
);

update public.qr_entry_slots
set
  slot_number = 1,
  label = '상인 전용 QR';

drop index if exists public.qr_entry_slots_store_id_slot_number_key;
create unique index if not exists qr_entry_slots_store_id_key
  on public.qr_entry_slots (store_id);

alter table public.qr_entry_slots
  alter column slot_number set default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'qr_entry_slots_single_slot_check'
      and conrelid = 'public.qr_entry_slots'::regclass
  ) then
    alter table public.qr_entry_slots
      add constraint qr_entry_slots_single_slot_check
      check (slot_number = 1);
  end if;
end
$$;
