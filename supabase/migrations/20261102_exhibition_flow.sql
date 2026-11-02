create table if not exists public.exhibition_templates (
  id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id),
  user_id integer not null default 1 check (user_id = 1), name text not null,
  store_description text not null, menus jsonb not null, created_at timestamptz not null default now()
);
create table if not exists public.exhibition_uploads (
  id uuid primary key, store_id uuid not null references public.stores(id), user_id integer not null default 1 check (user_id = 1),
  creation_id uuid not null, scene_number integer not null check (scene_number between 1 and 20), menu_id text,
  media_type text not null check (media_type in ('image','video')), storage_bucket text not null, file_path text not null,
  mime_type text not null, file_size bigint not null, duration_seconds double precision, created_at timestamptz not null default now(),
  unique(store_id, creation_id, scene_number)
);
create table if not exists public.exhibition_script_jobs (
  id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id), user_id integer not null default 1 check (user_id = 1),
  creation_id uuid not null, input_digest text not null, input jsonb not null,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  result jsonb, failure_reason text, lease_owner uuid, lease_expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(store_id, creation_id)
);
create table if not exists public.exhibition_ads (
  id uuid primary key references public.submissions(id) on delete cascade, store_id uuid not null references public.stores(id),
  user_id integer not null default 1 check (user_id = 1), creation_id uuid not null, input_digest text not null,
  format text not null check (format in ('card_news','reels')), concept_id text not null, input jsonb not null,
  job_id uuid not null references public.generation_jobs(id),
  publish_status text not null default 'unpublished' check (publish_status in ('unpublished','publishing','published','failed')),
  deleted_at timestamptz, created_at timestamptz not null default now(),
  unique(store_id, creation_id)
);
create index if not exists exhibition_ads_listing on public.exhibition_ads(store_id, created_at desc, id desc) where deleted_at is null;
alter table public.generation_jobs add column if not exists progress jsonb not null default '{}'::jsonb;
alter table public.exhibition_templates enable row level security;
alter table public.exhibition_uploads enable row level security;
alter table public.exhibition_script_jobs enable row level security;
alter table public.exhibition_ads enable row level security;
revoke all on public.exhibition_templates, public.exhibition_uploads, public.exhibition_script_jobs, public.exhibition_ads from anon, authenticated;
grant all on public.exhibition_templates, public.exhibition_uploads, public.exhibition_script_jobs, public.exhibition_ads to service_role;
-- Raw job inputs include the private creation nonce. They must not be readable via public Supabase keys.
-- Application APIs already use the server-only service-role client.
alter table public.generation_jobs enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_assets enable row level security;
revoke all on public.generation_jobs, public.submissions, public.submission_assets from anon,authenticated;
grant all on public.generation_jobs, public.submissions, public.submission_assets to service_role;

create or replace function public.register_exhibition_upload(p_asset jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare row public.exhibition_uploads;
begin
  perform pg_advisory_xact_lock(hashtextextended((p_asset->>'store_id') || ':' || (p_asset->>'creation_id'), 0));
  if exists(select 1 from public.exhibition_ads where store_id = (p_asset->>'store_id')::uuid and creation_id = (p_asset->>'creation_id')::uuid) then
    raise exception 'CREATION_ALREADY_STARTED';
  end if;
  insert into public.exhibition_uploads(id,store_id,creation_id,scene_number,menu_id,media_type,storage_bucket,file_path,mime_type,file_size,duration_seconds)
  values ((p_asset->>'id')::uuid,(p_asset->>'store_id')::uuid,(p_asset->>'creation_id')::uuid,(p_asset->>'scene_number')::integer,p_asset->>'menu_id',p_asset->>'media_type',p_asset->>'storage_bucket',p_asset->>'file_path',p_asset->>'mime_type',(p_asset->>'file_size')::bigint,(p_asset->>'duration_seconds')::double precision)
  on conflict(store_id,creation_id,scene_number) do update set id=excluded.id,menu_id=excluded.menu_id,media_type=excluded.media_type,
    storage_bucket=excluded.storage_bucket,file_path=excluded.file_path,mime_type=excluded.mime_type,file_size=excluded.file_size,duration_seconds=excluded.duration_seconds
  returning * into row;
  return to_jsonb(row);
end;
$$;

create or replace function public.create_exhibition_ad(p_store_id uuid, p_input jsonb, p_digest text, p_assets uuid[], p_subtitles jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ad public.exhibition_ads; submission_id uuid; job_id uuid; scene jsonb; material public.exhibition_uploads; sources jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || ':' || (p_input->>'creationId'), 0));
  select * into ad from public.exhibition_ads where store_id=p_store_id and creation_id=(p_input->>'creationId')::uuid;
  if found then
    if ad.deleted_at is not null then raise exception 'AD_DELETED'; end if;
    if ad.input_digest <> p_digest then raise exception 'CREATION_CONFLICT'; end if;
    return jsonb_build_object('adId',ad.id,'jobId',ad.job_id,'reused',true);
  end if;
  if cardinality(p_assets) <> jsonb_array_length(p_input->'template'->'scenes') then raise exception 'MATERIALS_INVALID'; end if;
  for scene in select * from jsonb_array_elements(p_input->'template'->'scenes') loop
    select * into material from public.exhibition_uploads where id=any(p_assets) and store_id=p_store_id
      and creation_id=(p_input->>'creationId')::uuid and scene_number=(scene->>'sceneNumber')::integer for update;
    if not found or material.media_type <> scene->>'mediaType' or coalesce(material.menu_id,'') <> coalesce(scene->>'menuId','') then raise exception 'MATERIALS_INVALID'; end if;
    if material.media_type='video' and (material.duration_seconds is null or material.duration_seconds + 0.05 < (scene->>'durationSeconds')::double precision) then raise exception 'VIDEO_TOO_SHORT'; end if;
    sources := sources || jsonb_build_array(jsonb_build_object('assetId',material.id,'sceneNumber',material.scene_number,
      'storageBucket',material.storage_bucket,'filePath',material.file_path,'mimeType',material.mime_type));
  end loop;
  insert into public.submissions(store_id,submitter_name,store_type,target_menu_name,price_text,appeal_point,title,caption,hashtags,ai_metadata,status)
  values(p_store_id,'전시 체험','restaurant_food',p_input->'menus'->0->>'name','',p_input->>'storeDescription',p_input->'menus'->0->>'name',null,'[]'::jsonb,
    jsonb_build_object('exhibition',true,'adWorkflow',jsonb_build_object('adType',case when p_input->>'format'='reels' then 'video' else 'photo' end)), 'draft') returning id into submission_id;
  insert into public.generation_jobs(submission_id,store_id,status,style_preset,model_name,request_payload,progress)
  values(submission_id,p_store_id,'queued',case when p_input->>'format'='reels' then 'market_story' else 'food_card_news' end,
    case when p_input->>'format'='reels' then 'render-exhibition-video' else 'gpt-image-2' end,
    jsonb_build_object('source','exhibition','input',p_input,'materials',sources,'subtitles',p_subtitles),
    jsonb_build_object('stage','queued','current',0,'total',jsonb_array_length(p_input->'template'->'scenes') + 2,'message','광고 제작을 준비하고 있어요.')) returning id into job_id;
  insert into public.exhibition_ads(id,store_id,creation_id,input_digest,format,concept_id,input,job_id)
  values(submission_id,p_store_id,(p_input->>'creationId')::uuid,p_digest,p_input->>'format',p_input->>'conceptId',p_input,job_id) returning * into ad;
  return jsonb_build_object('adId',ad.id,'jobId',ad.job_id,'reused',false);
end;
$$;

create or replace function public.claim_exhibition_script(p_job_id uuid, p_owner uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.exhibition_script_jobs set status='processing',lease_owner=p_owner,lease_expires_at=now()+interval '3 minutes',updated_at=now()
    where id=p_job_id and (status='queued' or (status='processing' and lease_expires_at < now()));
  return found;
end;
$$;
revoke all on function public.register_exhibition_upload(jsonb) from public, anon, authenticated;
revoke all on function public.create_exhibition_ad(uuid,jsonb,text,uuid[],jsonb) from public, anon, authenticated;
revoke all on function public.claim_exhibition_script(uuid,uuid) from public, anon, authenticated;
grant execute on function public.register_exhibition_upload(jsonb) to service_role;
grant execute on function public.create_exhibition_ad(uuid,jsonb,text,uuid[],jsonb) to service_role;
grant execute on function public.claim_exhibition_script(uuid,uuid) to service_role;

create or replace function public.sync_exhibition_publish_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.exhibition_ads set publish_status=case
    when new.status='published' or new.ai_metadata->'instagramPublish'->>'status'='published' then 'published'
    when new.ai_metadata->'instagramPublish'->>'status'='processing' then 'publishing'
    when new.ai_metadata->'instagramPublish'->>'status'='failed' then 'failed' else 'unpublished' end
  where id=new.id;
  return new;
end;
$$;
drop trigger if exists sync_exhibition_publish_status on public.submissions;
create trigger sync_exhibition_publish_status after update of status,ai_metadata on public.submissions
for each row execute function public.sync_exhibition_publish_status();
revoke all on function public.sync_exhibition_publish_status() from public,anon,authenticated;

create or replace function public.update_exhibition_caption(p_ad_id uuid,p_store_id uuid,p_caption text)
returns void language plpgsql security definer set search_path=public as $$
declare state public.submissions;
begin
  if not exists(select 1 from public.exhibition_ads a join public.generation_jobs j on j.id=a.job_id where a.id=p_ad_id and a.store_id=p_store_id and a.deleted_at is null and j.status='completed') then raise exception 'AD_NOT_READY'; end if;
  select * into state from public.submissions where id=p_ad_id for update;
  if state.status='published' or state.ai_metadata->'instagramPublish'->>'status' in ('processing','published') then raise exception 'CAPTION_LOCKED'; end if;
  if char_length(p_caption)>2200 or (select count(*) from regexp_matches(p_caption,'#[^[:space:]#]+','g'))>30 then raise exception 'CAPTION_INVALID'; end if;
  update public.submissions set caption=p_caption,hashtags='[]'::jsonb where id=p_ad_id;
end;
$$;
create or replace function public.delete_exhibition_ad(p_ad_id uuid,p_store_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform 1 from public.exhibition_ads where id=p_ad_id and store_id=p_store_id for update;
  if not found then raise exception 'AD_NOT_FOUND'; end if;
  if exists(select 1 from public.submissions where id=p_ad_id and ai_metadata->'instagramPublish'->>'status'='processing') then raise exception 'PUBLISH_IN_PROGRESS'; end if;
  update public.exhibition_ads set deleted_at=coalesce(deleted_at,now()) where id=p_ad_id;
  update public.submissions set ai_metadata=jsonb_set(coalesce(ai_metadata,'{}'::jsonb),'{exhibitionDeletedAt}',to_jsonb(now()::text)) where id=p_ad_id;
  update public.generation_jobs set status='failed',failure_reason='삭제된 광고예요.',progress='{"stage":"cancelled","message":"삭제된 광고예요."}'::jsonb where submission_id=p_ad_id and status='queued';
end;
$$;
create or replace function public.retry_exhibition_generation(p_ad_id uuid,p_store_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare selected_job uuid;
begin
  select job_id into selected_job from public.exhibition_ads where id=p_ad_id and store_id=p_store_id and deleted_at is null and publish_status not in ('published','publishing') for update;
  if not found then raise exception 'AD_NOT_READY'; end if;
  update public.generation_jobs set status='queued',failure_reason=null,started_at=null,completed_at=null,progress='{"stage":"queued","message":"다시 제작을 준비하고 있어요."}'::jsonb where id=selected_job and status='failed';
  return selected_job;
end;
$$;
revoke all on function public.update_exhibition_caption(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.delete_exhibition_ad(uuid,uuid) from public,anon,authenticated;
revoke all on function public.retry_exhibition_generation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.update_exhibition_caption(uuid,uuid,text) to service_role;
grant execute on function public.delete_exhibition_ad(uuid,uuid) to service_role;
grant execute on function public.retry_exhibition_generation(uuid,uuid) to service_role;

-- Extend the storage remap for the exhibition upload registry and job snapshots.
-- Storage references are provider-qualified strings: uploads (Supabase), s3:<bucket> (AWS).
-- Object keys stay unchanged. This RPC switches every known reference to one verified object atomically.
create or replace function public.remap_media_storage_reference(p_from text, p_to text, p_file_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare asset_count integer; session_count integer; job_count integer; source_count integer; workflow_count integer; exhibition_count integer; material_count integer;
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
  update public.exhibition_uploads set storage_bucket=p_to where storage_bucket=p_from and file_path=p_file_path;
  get diagnostics exhibition_count = row_count;
  update public.generation_jobs j set request_payload=jsonb_set(request_payload,'{materials}',(
    select jsonb_agg(case when item->>'storageBucket'=p_from and item->>'filePath'=p_file_path
      then jsonb_set(item,'{storageBucket}',to_jsonb(p_to)) else item end order by position)
    from jsonb_array_elements(j.request_payload->'materials') with ordinality as source(item,position)
  )) where jsonb_typeof(request_payload->'materials')='array' and exists(
    select 1 from jsonb_array_elements(case when jsonb_typeof(j.request_payload->'materials')='array' then j.request_payload->'materials' else '[]'::jsonb end) item
    where item->>'storageBucket'=p_from and item->>'filePath'=p_file_path);
  get diagnostics material_count = row_count;
  return jsonb_build_object('assets', asset_count, 'sessionAssets', session_count, 'jobResults', job_count,
    'jobSources', source_count, 'videoWorkflows', workflow_count, 'exhibitionUploads', exhibition_count, 'exhibitionMaterials', material_count);
end;
$$;
revoke all on function public.remap_media_storage_reference(text, text, text) from public, anon, authenticated;
grant execute on function public.remap_media_storage_reference(text, text, text) to service_role;
