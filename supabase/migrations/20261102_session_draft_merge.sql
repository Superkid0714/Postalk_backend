create or replace function public.merge_ad_session_draft(p_session_id uuid, p_draft jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ad_creation_sessions set workflow = workflow || p_draft where id = p_session_id;
  if not found then raise exception 'Session not found'; end if;
end;
$$;
revoke all on function public.merge_ad_session_draft(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.merge_ad_session_draft(uuid, jsonb) to service_role;
