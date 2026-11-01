-- Storage references are provider-qualified strings: uploads (Supabase), s3:<bucket> (AWS).
-- Object keys stay unchanged. This RPC switches every known reference to one verified object atomically.
create or replace function public.remap_media_storage_reference(p_from text, p_to text, p_file_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare asset_count integer; session_count integer; job_count integer; source_count integer; workflow_count integer;
begin
  if p_from = p_to or p_file_path = '' or
    not (p_from = 'uploads' or p_from ~ '^s3:[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$') or
    not (p_to = 'uploads' or p_to ~ '^s3:[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$') then
    raise exception 'Invalid media storage remap';
  end if;
  update public.submission_assets set storage_bucket = p_to where storage_bucket = p_from and file_path = p_file_path;
  get diagnostics asset_count = row_count;
  update public.ad_creation_session_assets set storage_bucket = p_to where storage_bucket = p_from and file_path = p_file_path;
  get diagnostics session_count = row_count;
  update public.generation_jobs set result_storage_bucket = p_to
    where result_storage_bucket = p_from and result_file_path = p_file_path;
  get diagnostics job_count = row_count;
  update public.generation_jobs j set request_payload = jsonb_set(request_payload, '{sourceVideos}', (
    select jsonb_agg(case when item->>'storageBucket' = p_from and item->>'filePath' = p_file_path
      then jsonb_set(item, '{storageBucket}', to_jsonb(p_to)) else item end order by position)
    from jsonb_array_elements(j.request_payload->'sourceVideos') with ordinality as source(item, position)
  )) where jsonb_typeof(request_payload->'sourceVideos') = 'array' and exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(j.request_payload->'sourceVideos') = 'array'
      then j.request_payload->'sourceVideos' else '[]'::jsonb end) item
    where item->>'storageBucket' = p_from and item->>'filePath' = p_file_path
  );
  get diagnostics source_count = row_count;
  update public.submissions set ai_metadata = jsonb_set(ai_metadata, '{videoWorkflow,resultStorageBucket}', to_jsonb(p_to))
    where ai_metadata->'videoWorkflow'->>'resultStorageBucket' = p_from
      and ai_metadata->'videoWorkflow'->>'resultFilePath' = p_file_path;
  get diagnostics workflow_count = row_count;
  return jsonb_build_object('assets', asset_count, 'sessionAssets', session_count, 'jobResults', job_count,
    'jobSources', source_count, 'videoWorkflows', workflow_count);
end;
$$;
revoke all on function public.remap_media_storage_reference(text, text, text) from public, anon, authenticated;
grant execute on function public.remap_media_storage_reference(text, text, text) to service_role;
