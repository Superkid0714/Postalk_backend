-- Run after confirming there are no files or rows stored outside Supabase Storage.
do $$
begin
  if exists (select 1 from public.media_assets where provider <> 'supabase' or bucket <> 'uploads') then
    raise exception 'Supabase-only migration stopped: non-Supabase media rows exist';
  end if;
end;
$$;

alter table public.media_assets drop constraint if exists media_assets_provider_check;
alter table public.media_assets drop constraint if exists media_assets_bucket_check;
alter table public.media_assets add constraint media_assets_provider_check check (provider = 'supabase');
alter table public.media_assets add constraint media_assets_bucket_check check (bucket = 'uploads');

create or replace function public.remap_media_storage_reference(p_from text, p_to text, p_file_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Media storage remapping is not supported';
end;
$$;
