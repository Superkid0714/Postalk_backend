create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  role text not null default 'seller' check (role = 'seller'),
  name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  market_name text not null,
  store_name text not null,
  owner_name text,
  category text,
  description text,
  latitude double precision,
  longitude double precision,
  location_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists stores_market_name_store_name_key
  on public.stores (market_name, store_name);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  submitter_name text not null,
  submitter_affiliation text,
  qr_payload text,
  store_type text not null,
  target_menu_name text not null,
  price_text text not null,
  appeal_point text not null,
  extra_message text,
  title text,
  caption text,
  hashtags jsonb not null default '[]'::jsonb,
  transcript text,
  ai_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists submissions_store_id_idx on public.submissions (store_id);
create index if not exists submissions_status_idx on public.submissions (status);
create index if not exists submissions_created_at_idx on public.submissions (created_at desc);

create table if not exists public.submission_assets (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  asset_type text not null
    check (asset_type in ('menu_board', 'food_photo', 'generated_image', 'generated_video', 'video_thumbnail')),
  storage_bucket text not null default 'uploads',
  file_path text not null,
  file_name text,
  mime_type text,
  file_size bigint,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists submission_assets_submission_id_idx
  on public.submission_assets (submission_id);

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  style_preset text not null default 'menu_highlight'
    check (style_preset in ('menu_highlight', 'clean_poster', 'market_story', 'food_card_news', 'food_closeup', 'premium')),
  prompt_text text,
  model_name text not null default 'gpt-image-2',
  image_size text not null default '1536x1024',
  quality text not null default 'medium',
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  failure_reason text,
  result_asset_id uuid references public.submission_assets(id) on delete set null,
  result_storage_bucket text,
  result_file_path text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists generation_jobs_submission_id_idx
  on public.generation_jobs (submission_id);

create index if not exists generation_jobs_store_id_idx
  on public.generation_jobs (store_id);

create index if not exists generation_jobs_status_idx
  on public.generation_jobs (status);

create table if not exists public.ad_creation_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  ad_type text not null check (ad_type in ('photo', 'video')),
  intro_text text not null,
  status text not null default 'collecting'
    check (status in ('collecting', 'ready_for_generation', 'generating', 'completed', 'failed')),
  style_preset text not null default 'food_card_news',
  workflow jsonb not null default '{}'::jsonb,
  submission_id uuid references public.submissions(id) on delete set null,
  generation_job_id uuid references public.generation_jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_creation_sessions_store_id_idx
  on public.ad_creation_sessions (store_id);

create index if not exists ad_creation_sessions_status_idx
  on public.ad_creation_sessions (status);

create table if not exists public.ad_creation_session_assets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ad_creation_sessions(id) on delete cascade,
  shot_key text not null
    check (shot_key in (
      'menu_board',
      'signature_menu',
      'flatlay_menu',
      'cooking_scene',
      'detail_closeup',
      'video_storefront_sign',
      'video_storefront_entry',
      'video_menu_board',
      'video_signature_menu',
      'video_signature_interaction',
      'video_cooking_scene',
      'video_side_menu',
      'video_side_menu_interaction'
    )),
  asset_type text not null
    check (asset_type in ('menu_board', 'food_photo', 'video_clip')),
  storage_bucket text not null default 'uploads',
  file_path text not null,
  file_name text,
  mime_type text,
  file_size bigint,
  sort_order integer not null default 0,
  review_passed boolean not null default false,
  review_score integer,
  review_summary text,
  review_feedback jsonb not null default '[]'::jsonb,
  review_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ad_creation_session_assets_session_id_idx
  on public.ad_creation_session_assets (session_id);

create table if not exists public.merchant_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  qr_token text not null unique,
  status text not null default 'ready'
    check (status in ('ready', 'activated', 'disabled')),
  assigned_store_id uuid references public.stores(id) on delete set null,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists merchant_qr_tokens_status_idx
  on public.merchant_qr_tokens (status);

create index if not exists merchant_qr_tokens_assigned_store_id_idx
  on public.merchant_qr_tokens (assigned_store_id);

create table if not exists public.qr_entry_slots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  slot_number integer not null default 1 check (slot_number = 1),
  slot_key text not null unique,
  label text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists qr_entry_slots_store_id_key
  on public.qr_entry_slots (store_id);

create index if not exists qr_entry_slots_store_id_idx
  on public.qr_entry_slots (store_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row
execute function public.set_updated_at();

drop trigger if exists stores_set_updated_at on public.stores;
create trigger stores_set_updated_at
before update on public.stores
for each row
execute function public.set_updated_at();

drop trigger if exists submissions_set_updated_at on public.submissions;
create trigger submissions_set_updated_at
before update on public.submissions
for each row
execute function public.set_updated_at();

drop trigger if exists generation_jobs_set_updated_at on public.generation_jobs;
create trigger generation_jobs_set_updated_at
before update on public.generation_jobs
for each row
execute function public.set_updated_at();

drop trigger if exists ad_creation_sessions_set_updated_at on public.ad_creation_sessions;
create trigger ad_creation_sessions_set_updated_at
before update on public.ad_creation_sessions
for each row
execute function public.set_updated_at();

drop trigger if exists qr_entry_slots_set_updated_at on public.qr_entry_slots;
create trigger qr_entry_slots_set_updated_at
before update on public.qr_entry_slots
for each row
execute function public.set_updated_at();

drop trigger if exists merchant_qr_tokens_set_updated_at on public.merchant_qr_tokens;
create trigger merchant_qr_tokens_set_updated_at
before update on public.merchant_qr_tokens
for each row
execute function public.set_updated_at();

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

create unique index if not exists generation_jobs_one_active_per_submission
on public.generation_jobs(submission_id) where status in ('queued', 'processing');

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

create or replace function public.merge_ad_session_draft(p_session_id uuid, p_draft jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ad_creation_sessions set workflow = workflow || p_draft where id = p_session_id;
  if not found then raise exception 'Session not found'; end if;
end;
$$;
revoke all on function public.merge_ad_session_draft(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.merge_ad_session_draft(uuid, jsonb) to service_role;

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
