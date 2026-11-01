create table if not exists public.submission_publish_leases (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  owner uuid not null,
  expires_at timestamptz not null
);
alter table public.submission_publish_leases enable row level security;
revoke all on public.submission_publish_leases from anon, authenticated;
grant all on public.submission_publish_leases to service_role;

create or replace function public.claim_submission_publish(p_submission_id uuid, p_owner uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare claimed uuid;
begin
  insert into public.submission_publish_leases(submission_id, owner, expires_at)
  values (p_submission_id, p_owner, now() + interval '15 minutes')
  on conflict (submission_id) do update set owner = excluded.owner, expires_at = excluded.expires_at
  where submission_publish_leases.expires_at < now()
  returning submission_id into claimed;
  return claimed is not null;
end;
$$;
create or replace function public.renew_submission_publish(p_submission_id uuid, p_owner uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.submission_publish_leases set expires_at = now() + interval '15 minutes'
  where submission_id = p_submission_id and owner = p_owner and expires_at > now();
  return found;
end;
$$;
revoke all on function public.claim_submission_publish(uuid, uuid) from public, anon, authenticated;
revoke all on function public.renew_submission_publish(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_submission_publish(uuid, uuid) to service_role;
grant execute on function public.renew_submission_publish(uuid, uuid) to service_role;

-- Merge only the requested metadata section while holding the submission row lock.
create or replace function public.update_submission_instagram_metadata(p_submission_id uuid, p_section text, p_updates jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_section not in ('instagramPublish', 'instagramMetrics') then
    raise exception 'Unsupported metadata section';
  end if;
  update public.submissions
  set ai_metadata = jsonb_set(coalesce(ai_metadata, '{}'::jsonb), array[p_section],
    coalesce(ai_metadata->p_section, '{}'::jsonb) || p_updates),
    status = case when p_section = 'instagramPublish' and p_updates->>'status' = 'published' then 'published' else status end
  where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
end;
$$;
revoke all on function public.update_submission_instagram_metadata(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.update_submission_instagram_metadata(uuid, text, jsonb) to service_role;
