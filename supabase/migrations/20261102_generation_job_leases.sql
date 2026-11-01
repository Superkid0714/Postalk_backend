create table if not exists public.generation_job_leases (
  job_id uuid primary key references public.generation_jobs(id) on delete cascade,
  owner uuid not null,
  expires_at timestamptz not null
);
alter table public.generation_job_leases enable row level security;
revoke all on public.generation_job_leases from anon, authenticated;
grant all on public.generation_job_leases to service_role;

create or replace function public.claim_generation_job(p_job_id uuid, p_owner uuid, p_lease_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare claimed uuid;
begin
  insert into public.generation_job_leases(job_id, owner, expires_at)
  values (p_job_id, p_owner, now() + make_interval(secs => least(greatest(p_lease_seconds, 60), 3600)))
  on conflict (job_id) do update set owner = excluded.owner, expires_at = excluded.expires_at
  where generation_job_leases.expires_at < now()
  returning job_id into claimed;
  return claimed is not null;
end;
$$;

create or replace function public.renew_generation_job_lease(p_job_id uuid, p_owner uuid, p_lease_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.generation_job_leases
  set expires_at = now() + make_interval(secs => least(greatest(p_lease_seconds, 60), 3600))
  where job_id = p_job_id and owner = p_owner and expires_at > now();
  return found;
end;
$$;
revoke all on function public.claim_generation_job(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.renew_generation_job_lease(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_generation_job(uuid, uuid, integer) to service_role;
grant execute on function public.renew_generation_job_lease(uuid, uuid, integer) to service_role;
