-- Apply LAST, after 20261102_exhibition_flow.sql. No external services are called.
-- Existing API names remain updatable compatibility views over the same rows.
begin;

do $$ begin
  if exists(select 1 from pg_class where oid=to_regclass('public.exhibition_templates') and relkind='r') then
    alter table public.exhibition_templates rename to input_templates;
    alter table public.exhibition_script_jobs rename to script_jobs;
    alter table public.exhibition_ads rename to contents;
  end if;
end $$;

create table if not exists public.concept_versions (
  id uuid primary key default gen_random_uuid(), concept_key text not null,
  template_key text not null, version text not null, format text not null check(format in ('card_news','reels')),
  renderer_key text not null, uses_subtitles boolean not null, max_subtitle_chars integer not null check(max_subtitle_chars between 1 and 100),
  scene_definition jsonb not null, definition_digest text not null, created_at timestamptz not null default now(),
  unique(concept_key,template_key,version,format,definition_digest)
);
create table if not exists public.creation_sessions (
  id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id),
  creation_id uuid not null, concept_version_id uuid references public.concept_versions(id),
  input_snapshot jsonb, status text not null default 'collecting' check(status in ('collecting','submitted','abandoned')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(store_id,creation_id), unique(id,store_id)
);
create table if not exists public.creation_scenes (
  id uuid primary key default gen_random_uuid(), session_id uuid not null, store_id uuid not null,
  scene_number integer not null check(scene_number between 1 and 20), target text,
  menu_key text, media_type text not null check(media_type in ('image','video')),
  subtitle text, duration_seconds double precision check(duration_seconds between 1 and 15),
  foreign key(session_id,store_id) references public.creation_sessions(id,store_id),
  unique(session_id,scene_number), unique(id,session_id,store_id)
);
create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id),
  provider text not null check(provider in ('supabase','s3')), bucket text not null, object_key text not null,
  mime_type text, file_size bigint check(file_size>=0), duration_seconds double precision,
  checksum_sha256 text check(checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(), unique(provider,bucket,object_key), unique(id,store_id)
);
create table if not exists public.scene_media (
  scene_id uuid primary key, session_id uuid not null, store_id uuid not null, media_asset_id uuid not null,
  foreign key(scene_id,session_id,store_id) references public.creation_scenes(id,session_id,store_id),
  foreign key(media_asset_id,store_id) references public.media_assets(id,store_id)
);

alter table public.script_jobs add column if not exists session_id uuid;
alter table public.contents add column if not exists session_id uuid;
alter table public.contents add column if not exists caption text;
alter table public.generation_jobs add column if not exists content_id uuid;
alter table public.submission_assets add column if not exists media_asset_id uuid references public.media_assets(id);
alter table public.submission_assets add column if not exists generation_job_id uuid references public.generation_jobs(id);
alter table public.submission_assets add column if not exists checksum_sha256 text;
alter table public.ad_creation_session_assets add column if not exists media_asset_id uuid references public.media_assets(id);
alter table public.exhibition_uploads add column if not exists media_asset_id uuid references public.media_assets(id);
alter table public.exhibition_uploads add column if not exists checksum_sha256 text;
create unique index if not exists contents_session_key on public.contents(session_id);
create unique index if not exists contents_scope_key on public.contents(id,store_id);
create unique index if not exists generation_jobs_content_scope_key on public.generation_jobs(id,content_id,store_id);
create index if not exists generation_jobs_content_idx on public.generation_jobs(content_id) where content_id is not null;
create index if not exists submission_assets_media_idx on public.submission_assets(media_asset_id);
create index if not exists session_assets_media_idx on public.ad_creation_session_assets(media_asset_id);
create index if not exists exhibition_uploads_media_idx on public.exhibition_uploads(media_asset_id);
create index if not exists scene_media_asset_idx on public.scene_media(media_asset_id);

create table if not exists public.content_outputs (
  id uuid primary key default gen_random_uuid(), content_id uuid not null, store_id uuid not null,
  generation_job_id uuid not null, media_asset_id uuid not null,
  purpose text not null check(purpose in ('card_image','reel_video','thumbnail','narration')),
  sort_order integer not null default 0 check(sort_order>=0),
  foreign key(generation_job_id,content_id,store_id) references public.generation_jobs(id,content_id,store_id),
  foreign key(media_asset_id,store_id) references public.media_assets(id,store_id),
  unique(generation_job_id,purpose,sort_order)
);
create table if not exists public.publication_attempts (
  id uuid primary key default gen_random_uuid(), content_id uuid not null, store_id uuid not null,
  platform text not null default 'instagram' check(platform='instagram'),
  attempt_number integer not null check(attempt_number>0), request_key text not null,
  status text not null check(status in ('queued','publishing','published','failed','unknown')),
  caption_snapshot text, media_snapshot jsonb not null default '[]'::jsonb,
  external_container_id text, external_post_id text, permalink text, failure_reason text,
  published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(content_id,store_id) references public.contents(id,store_id),
  unique(content_id,platform,attempt_number), unique(content_id,platform,request_key)
);
create index if not exists content_outputs_media_idx on public.content_outputs(media_asset_id);
create unique index if not exists publication_attempts_one_pending_or_published
  on public.publication_attempts(content_id,platform) where status in ('queued','publishing','published','unknown');

-- The supplied version plus a definition digest identifies an immutable snapshot.
-- Dynamic scene/menu variants do not overwrite one another under the same vendor label.
create or replace function public.ensure_creation_session(p_store_id uuid,p_creation_id uuid,p_input jsonb default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare selected_session public.creation_sessions; concept uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || ':' || p_creation_id::text,0));
  insert into public.creation_sessions(store_id,creation_id) values(p_store_id,p_creation_id)
    on conflict(store_id,creation_id) do nothing;
  select * into selected_session from public.creation_sessions where store_id=p_store_id and creation_id=p_creation_id for update;
  if p_input is not null then
    if selected_session.status='submitted' and selected_session.input_snapshot is distinct from p_input then raise exception 'CREATION_CONFLICT'; end if;
    insert into public.concept_versions(concept_key,template_key,version,format,renderer_key,uses_subtitles,max_subtitle_chars,scene_definition,definition_digest)
    values(p_input->>'conceptId',p_input->'template'->>'id',p_input->'template'->>'version',p_input->>'format',
      coalesce(p_input->'template'->>'renderer',case when p_input->>'format'='reels' then 'scene-reel-v1' else 'source-photo-v1' end),
      (p_input->'template'->>'usesSubtitles')::boolean,coalesce((p_input->'template'->>'maxSubtitleChars')::integer,40),
      p_input->'template',md5((p_input->'template')::text))
    on conflict(concept_key,template_key,version,format,definition_digest) do update set concept_key=excluded.concept_key
    returning id into concept;
    update public.creation_sessions set concept_version_id=concept,input_snapshot=p_input,updated_at=now() where id=selected_session.id;
  end if;
  return selected_session.id;
end;
$$;

create or replace function public.freeze_concept_version()
returns trigger language plpgsql set search_path=public as $$ begin
  if new is distinct from old then raise exception 'CONCEPT_VERSION_IMMUTABLE'; end if;
  return new;
end $$;
drop trigger if exists freeze_concept_version on public.concept_versions;
create trigger freeze_concept_version before update on public.concept_versions for each row execute function public.freeze_concept_version();

create or replace function public.protect_submitted_session()
returns trigger language plpgsql set search_path=public as $$ begin
  if old.status='submitted' and (new.input_snapshot is distinct from old.input_snapshot or new.concept_version_id is distinct from old.concept_version_id or new.status='collecting') then
    raise exception 'CREATION_FROZEN';
  end if;
  return new;
end $$;
drop trigger if exists protect_submitted_session on public.creation_sessions;
create trigger protect_submitted_session before update on public.creation_sessions for each row execute function public.protect_submitted_session();

create or replace function public.bind_workflow_session()
returns trigger language plpgsql security definer set search_path=public as $$
declare session uuid; scene jsonb; edited jsonb; selected_job public.generation_jobs;
begin
  session:=public.ensure_creation_session(new.store_id,new.creation_id,new.input);
  new.session_id:=session;
  if tg_table_name='contents' then
    select * into selected_job from public.generation_jobs where id=new.job_id and submission_id=new.id and store_id=new.store_id;
    if not found then raise exception 'JOB_CONTENT_SCOPE_INVALID'; end if;
    for scene in select * from jsonb_array_elements(new.input->'template'->'scenes') loop
      select value into edited from jsonb_array_elements(coalesce(selected_job.request_payload->'subtitles','[]'::jsonb)) where (value->>'sceneNumber')::int=(scene->>'sceneNumber')::int;
      insert into public.creation_scenes(session_id,store_id,scene_number,target,menu_key,media_type,subtitle,duration_seconds)
      values(session,new.store_id,(scene->>'sceneNumber')::int,scene->>'target',scene->>'menuId',scene->>'mediaType',edited->>'text',coalesce((scene->>'durationSeconds')::float8,3))
      on conflict(session_id,scene_number) do update set target=excluded.target,menu_key=excluded.menu_key,media_type=excluded.media_type,subtitle=excluded.subtitle,duration_seconds=excluded.duration_seconds;
    end loop;
    update public.creation_sessions set status='submitted',updated_at=now() where id=session;
    select caption into new.caption from public.submissions where id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists bind_script_session on public.script_jobs;
create trigger bind_script_session before insert on public.script_jobs for each row execute function public.bind_workflow_session();
drop trigger if exists bind_content_session on public.contents;
create trigger bind_content_session before insert on public.contents for each row execute function public.bind_workflow_session();

create or replace function public.bind_content_job()
returns trigger language plpgsql security definer set search_path=public as $$ begin
  update public.generation_jobs set content_id=new.id where submission_id=new.id and store_id=new.store_id;
  insert into public.scene_media(scene_id,session_id,store_id,media_asset_id)
    select s.id,s.session_id,s.store_id,u.media_asset_id from public.creation_scenes s
    join public.exhibition_uploads u on u.store_id=s.store_id and u.creation_id=new.creation_id and u.scene_number=s.scene_number
    where s.session_id=new.session_id and u.media_asset_id is not null
    on conflict(scene_id) do update set media_asset_id=excluded.media_asset_id;
  return new;
end $$;
drop trigger if exists bind_content_job on public.contents;
create trigger bind_content_job after insert on public.contents for each row execute function public.bind_content_job();

create or replace function public.check_generation_content_scope()
returns trigger language plpgsql security definer set search_path=public as $$ begin
  if not exists(select 1 from public.submissions where id=new.submission_id and store_id=new.store_id) then raise exception 'JOB_STORE_SCOPE_INVALID'; end if;
  if new.content_id is null then select id into new.content_id from public.contents where id=new.submission_id; end if;
  if new.content_id is not null and new.content_id<>new.submission_id then raise exception 'JOB_CONTENT_SCOPE_INVALID'; end if;
  return new;
end $$;
drop trigger if exists check_generation_content_scope on public.generation_jobs;
create trigger check_generation_content_scope before insert or update of content_id,submission_id,store_id on public.generation_jobs for each row execute function public.check_generation_content_scope();

-- Original and generated files share one catalogue. The legacy row stores its id.
create or replace function public.bind_media_asset()
returns trigger language plpgsql security definer set search_path=public as $$
declare owner_store uuid; asset uuid; selected_session uuid; selected_scene uuid; provider_name text; bucket_name text; previous_id uuid;
begin
  if tg_table_name='submission_assets' then select store_id into owner_store from public.submissions where id=new.submission_id;
  elsif tg_table_name='ad_creation_session_assets' then select store_id into owner_store from public.ad_creation_sessions where id=new.session_id;
  else owner_store:=new.store_id;
    selected_session:=public.ensure_creation_session(new.store_id,new.creation_id);
  end if;
  provider_name:=case when new.storage_bucket like 's3:%' then 's3' else 'supabase' end;
  bucket_name:=case when provider_name='s3' then substr(new.storage_bucket,4) else new.storage_bucket end;
  if tg_op='UPDATE' and new.file_path=old.file_path and new.id=old.id then previous_id:=old.media_asset_id; end if;
  if previous_id is not null then
    update public.media_assets set provider=provider_name,bucket=bucket_name,mime_type=coalesce(new.mime_type,mime_type),file_size=coalesce(new.file_size,file_size)
      where id=previous_id and store_id=owner_store returning id into asset;
  end if;
  if asset is null then
    insert into public.media_assets(store_id,provider,bucket,object_key,mime_type,file_size)
    values(owner_store,provider_name,bucket_name,new.file_path,new.mime_type,new.file_size)
    on conflict(provider,bucket,object_key) do update set mime_type=coalesce(excluded.mime_type,media_assets.mime_type),file_size=coalesce(excluded.file_size,media_assets.file_size)
      where media_assets.store_id=excluded.store_id returning id into asset;
    if asset is null then raise exception 'MEDIA_STORE_SCOPE_INVALID'; end if;
  end if;
  new.media_asset_id:=asset;
  if tg_table_name='exhibition_uploads' then
    update public.media_assets set duration_seconds=coalesce(new.duration_seconds,duration_seconds),checksum_sha256=coalesce(new.checksum_sha256,checksum_sha256) where id=asset;
    insert into public.creation_scenes(session_id,store_id,scene_number,menu_key,media_type)
      values(selected_session,owner_store,new.scene_number,new.menu_id,new.media_type)
      on conflict(session_id,scene_number) do update set menu_key=excluded.menu_key,media_type=excluded.media_type;
    select id into selected_scene from public.creation_scenes where session_id=selected_session and scene_number=new.scene_number;
    insert into public.scene_media(scene_id,session_id,store_id,media_asset_id) values(selected_scene,selected_session,owner_store,asset)
      on conflict(scene_id) do update set media_asset_id=excluded.media_asset_id;
  elsif tg_table_name='submission_assets' then
    update public.media_assets set checksum_sha256=coalesce(new.checksum_sha256,checksum_sha256) where id=asset;
  end if;
  return new;
end $$;
drop trigger if exists bind_media_asset on public.submission_assets;
create trigger bind_media_asset before insert or update on public.submission_assets for each row execute function public.bind_media_asset();
drop trigger if exists bind_media_asset on public.ad_creation_session_assets;
create trigger bind_media_asset before insert or update on public.ad_creation_session_assets for each row execute function public.bind_media_asset();
drop trigger if exists bind_media_asset on public.exhibition_uploads;
create trigger bind_media_asset before insert or update on public.exhibition_uploads for each row execute function public.bind_media_asset();

create or replace function public.bind_content_output()
returns trigger language plpgsql security definer set search_path=public as $$
declare owner_store uuid; job uuid; output_purpose text;
begin
  select store_id into owner_store from public.contents where id=new.submission_id;
  if not found then return new; end if;
  output_purpose:=case new.asset_type when 'generated_image' then 'card_image' when 'generated_video' then 'reel_video' when 'video_thumbnail' then 'thumbnail' end;
  if output_purpose is null then return new; end if;
  job:=new.generation_job_id;
  if job is null then
    select id into job from public.generation_jobs where content_id=new.submission_id and
      (result_asset_id=new.id or result_payload->'generatedImages' @> jsonb_build_array(jsonb_build_object('assetId',new.id::text))
       or result_payload->>'thumbnailFilePath'=new.file_path) order by created_at desc limit 1;
  end if;
  if job is null then return new; end if;
  insert into public.content_outputs(content_id,store_id,generation_job_id,media_asset_id,purpose,sort_order)
    values(new.submission_id,owner_store,job,new.media_asset_id,output_purpose,new.sort_order)
    on conflict(generation_job_id,purpose,sort_order) do update set media_asset_id=excluded.media_asset_id;
  return new;
end $$;
drop trigger if exists bind_content_output on public.submission_assets;
create trigger bind_content_output after insert or update on public.submission_assets for each row execute function public.bind_content_output();

-- Older workers do not supply generation_job_id and some card thumbnails exist
-- only in result_payload. Catalogue these when the completed result is saved.
create or replace function public.catalog_completed_outputs()
returns trigger language plpgsql security definer set search_path=public as $$
declare thumbnail text; selected_media uuid; provider_name text; bucket_name text;
begin
  if new.content_id is null then return new; end if;
  update public.submission_assets set generation_job_id=new.id where submission_id=new.content_id and generation_job_id is null and
    (id=new.result_asset_id or new.result_payload->'generatedImages' @> jsonb_build_array(jsonb_build_object('assetId',id::text))
     or new.result_payload->>'thumbnailFilePath'=file_path);
  thumbnail:=new.result_payload->>'thumbnailFilePath';
  if thumbnail is not null and new.result_storage_bucket is not null then
    provider_name:=case when new.result_storage_bucket like 's3:%' then 's3' else 'supabase' end;
    bucket_name:=case when provider_name='s3' then substr(new.result_storage_bucket,4) else new.result_storage_bucket end;
    insert into public.media_assets(store_id,provider,bucket,object_key,mime_type)
      values(new.store_id,provider_name,bucket_name,thumbnail,'image/jpeg')
      on conflict(provider,bucket,object_key) do update set object_key=excluded.object_key where media_assets.store_id=excluded.store_id returning id into selected_media;
    if selected_media is null then raise exception 'MEDIA_STORE_SCOPE_INVALID'; end if;
    insert into public.content_outputs(content_id,store_id,generation_job_id,media_asset_id,purpose,sort_order)
      values(new.content_id,new.store_id,new.id,selected_media,'thumbnail',0)
      on conflict(generation_job_id,purpose,sort_order) do update set media_asset_id=excluded.media_asset_id;
  end if;
  return new;
end $$;
drop trigger if exists catalog_completed_outputs on public.generation_jobs;
create trigger catalog_completed_outputs after update of status on public.generation_jobs for each row when(new.status='completed') execute function public.catalog_completed_outputs();

create or replace function public.record_publication_attempt()
returns trigger language plpgsql security definer set search_path=public as $$
declare meta jsonb; current_attempt public.publication_attempts; request text; next_status text; owner_store uuid;
begin
  update public.contents set caption=new.caption where id=new.id and caption is distinct from new.caption;
  if tg_op='UPDATE' and new.ai_metadata->'instagramPublish' is not distinct from old.ai_metadata->'instagramPublish' then return new; end if;
  select store_id into owner_store from public.contents where id=new.id;
  if not found then return new; end if;
  meta:=new.ai_metadata->'instagramPublish';
  if meta is null or meta->>'status' is null then return new; end if;
  next_status:=case when meta->>'status'='published' then 'published' when meta->>'outcomeUnknown'='true' then 'unknown'
    when meta->>'status'='processing' then 'publishing' else 'failed' end;
  if next_status in ('publishing','unknown') and exists(select 1 from public.contents where id=new.id and deleted_at is not null) then raise exception 'AD_DELETED'; end if;
  request:=coalesce(meta->>'requestedAt','legacy-import');
  select * into current_attempt from public.publication_attempts where content_id=new.id and platform='instagram' and request_key=request;
  if not found then
    insert into public.publication_attempts(content_id,store_id,attempt_number,request_key,status,caption_snapshot,media_snapshot)
    values(new.id,owner_store,(select coalesce(max(attempt_number),0)+1 from public.publication_attempts where content_id=new.id),request,next_status,
      meta->>'caption',coalesce(meta->'assetIds','[]'::jsonb)) returning * into current_attempt;
  end if;
  update public.publication_attempts set status=next_status,external_container_id=meta->>'containerId',external_post_id=meta->>'publishedMediaId',
    permalink=meta->>'permalink',failure_reason=meta->>'lastError',published_at=(meta->>'publishedAt')::timestamptz,updated_at=now()
    where id=current_attempt.id;
  return new;
end $$;
drop trigger if exists record_publication_attempt on public.submissions;
create trigger record_publication_attempt after update of caption,ai_metadata,status on public.submissions for each row execute function public.record_publication_attempt();

-- Backfill reuses production write hooks, without re-uploading or invoking AI.
update public.submission_assets set file_path=file_path;
update public.ad_creation_session_assets set file_path=file_path;
update public.exhibition_uploads set file_path=file_path;
do $$ declare r record; selected_session uuid; begin
  for r in select * from public.script_jobs where session_id is null loop
    selected_session:=public.ensure_creation_session(r.store_id,r.creation_id,r.input);
    update public.script_jobs set session_id=selected_session where id=r.id;
  end loop;
end $$;
-- Reuse INSERT binding for pre-existing contents by calling a temporary UPDATE trigger.
drop trigger if exists backfill_content_session on public.contents;
create trigger backfill_content_session before update on public.contents for each row when(old.session_id is null) execute function public.bind_workflow_session();
update public.contents set input=input where session_id is null;
drop trigger backfill_content_session on public.contents;
update public.generation_jobs j set content_id=c.id from public.contents c where j.submission_id=c.id and j.store_id=c.store_id and j.content_id is null;
insert into public.scene_media(scene_id,session_id,store_id,media_asset_id)
  select s.id,s.session_id,s.store_id,u.media_asset_id from public.contents c join public.creation_scenes s on s.session_id=c.session_id
  join public.exhibition_uploads u on u.store_id=c.store_id and u.creation_id=c.creation_id and u.scene_number=s.scene_number
  on conflict(scene_id) do update set media_asset_id=excluded.media_asset_id;
update public.submission_assets set file_path=file_path;
update public.generation_jobs set status=status where content_id is not null and status='completed';
-- Force a publication snapshot import even when the JSON itself is unchanged.
do $$ declare r record; previous jsonb; begin
  for r in select s.id,s.ai_metadata from public.submissions s join public.contents c on c.id=s.id where s.ai_metadata ? 'instagramPublish' loop
    previous:=r.ai_metadata;
    update public.submissions set ai_metadata=ai_metadata-'instagramPublish' where id=r.id;
    update public.submissions set ai_metadata=previous where id=r.id;
  end loop;
end $$;

alter table public.script_jobs alter column session_id set not null;
alter table public.contents alter column session_id set not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='script_jobs_session_scope') then
    alter table public.script_jobs add constraint script_jobs_session_scope foreign key(session_id,store_id) references public.creation_sessions(id,store_id);
    alter table public.contents add constraint contents_session_scope foreign key(session_id,store_id) references public.creation_sessions(id,store_id);
    alter table public.generation_jobs add constraint generation_jobs_content_scope foreign key(content_id,store_id) references public.contents(id,store_id);
  end if;
end $$;

create or replace view public.exhibition_templates with (security_invoker=true) as
  select id,store_id,user_id,name,store_description,menus,created_at from public.input_templates;
create or replace view public.exhibition_script_jobs with (security_invoker=true) as
  select id,store_id,user_id,creation_id,input_digest,input,status,result,failure_reason,lease_owner,lease_expires_at,created_at,updated_at from public.script_jobs;
create or replace view public.exhibition_ads with (security_invoker=true) as
  select id,store_id,user_id,creation_id,input_digest,format,concept_id,input,job_id,publish_status,deleted_at,created_at from public.contents;

do $$ declare name text; begin
  foreach name in array array['concept_versions','creation_sessions','creation_scenes','media_assets','scene_media','content_outputs','publication_attempts','input_templates','script_jobs','contents'] loop
    execute format('alter table public.%I enable row level security',name);
    execute format('revoke all on public.%I from anon,authenticated',name);
    execute format('grant all on public.%I to service_role',name);
  end loop;
end $$;
revoke all on public.exhibition_templates,public.exhibition_script_jobs,public.exhibition_ads from anon,authenticated;
grant all on public.exhibition_templates,public.exhibition_script_jobs,public.exhibition_ads to service_role;
revoke all on function public.ensure_creation_session(uuid,uuid,jsonb),public.freeze_concept_version(),public.bind_workflow_session(),public.bind_content_job(),public.bind_media_asset(),public.bind_content_output(),public.record_publication_attempt() from public,anon,authenticated;
grant execute on function public.ensure_creation_session(uuid,uuid,jsonb) to service_role;

revoke all on function public.protect_submitted_session(),public.check_generation_content_scope() from public,anon,authenticated;
revoke all on function public.catalog_completed_outputs() from public,anon,authenticated;

-- Preserve the public RPC and record the checksum calculated from the uploaded bytes.
create or replace function public.register_exhibition_upload(p_asset jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row public.exhibition_uploads;
begin
  perform pg_advisory_xact_lock(hashtextextended((p_asset->>'store_id') || ':' || (p_asset->>'creation_id'),0));
  if exists(select 1 from public.contents where store_id=(p_asset->>'store_id')::uuid and creation_id=(p_asset->>'creation_id')::uuid) then raise exception 'CREATION_ALREADY_STARTED'; end if;
  insert into public.exhibition_uploads(id,store_id,creation_id,scene_number,menu_id,media_type,storage_bucket,file_path,mime_type,file_size,duration_seconds,checksum_sha256)
  values((p_asset->>'id')::uuid,(p_asset->>'store_id')::uuid,(p_asset->>'creation_id')::uuid,(p_asset->>'scene_number')::int,
    p_asset->>'menu_id',p_asset->>'media_type',p_asset->>'storage_bucket',p_asset->>'file_path',p_asset->>'mime_type',
    (p_asset->>'file_size')::bigint,(p_asset->>'duration_seconds')::float8,p_asset->>'checksum_sha256')
  on conflict(store_id,creation_id,scene_number) do update set id=excluded.id,menu_id=excluded.menu_id,media_type=excluded.media_type,
    storage_bucket=excluded.storage_bucket,file_path=excluded.file_path,mime_type=excluded.mime_type,file_size=excluded.file_size,
    duration_seconds=excluded.duration_seconds,checksum_sha256=excluded.checksum_sha256 returning * into row;
  return to_jsonb(row);
end $$;

-- Lock order matches metadata updates: submission first, then content.
create or replace function public.delete_exhibition_ad(p_ad_id uuid,p_store_id uuid)
returns void language plpgsql security definer set search_path=public as $$ begin
  perform 1 from public.submissions where id=p_ad_id and store_id=p_store_id for update;
  if not found then raise exception 'AD_NOT_FOUND'; end if;
  perform 1 from public.contents where id=p_ad_id and store_id=p_store_id for update;
  if not found then raise exception 'AD_NOT_FOUND'; end if;
  if exists(select 1 from public.submissions where id=p_ad_id and ai_metadata->'instagramPublish'->>'status'='processing') then raise exception 'PUBLISH_IN_PROGRESS'; end if;
  update public.contents set deleted_at=coalesce(deleted_at,now()) where id=p_ad_id;
  update public.submissions set ai_metadata=jsonb_set(coalesce(ai_metadata,'{}'::jsonb),'{exhibitionDeletedAt}',to_jsonb(now()::text)) where id=p_ad_id;
  update public.generation_jobs set status='failed',failure_reason='삭제된 광고예요.',progress='{"stage":"cancelled","message":"삭제된 광고예요."}'::jsonb where submission_id=p_ad_id and status='queued';
end $$;

alter table public.publication_attempts add column if not exists reconciliation_evidence text;
alter table public.publication_attempts add column if not exists reconciled_at timestamptz;
create or replace function public.reconcile_instagram_publication(p_submission_id uuid,p_published_media_id text,p_evidence text,p_permalink text default null)
returns void language plpgsql security definer set search_path=public as $$
declare state public.submissions; meta jsonb;
begin
  if char_length(trim(coalesce(p_evidence,'')))<10 then raise exception 'VERIFICATION_EVIDENCE_REQUIRED'; end if;
  if p_permalink is not null and p_permalink !~ '^https://(www\.)?instagram\.com/' then raise exception 'INVALID_PERMALINK'; end if;
  select * into state from public.submissions where id=p_submission_id for update;
  if not found then raise exception 'SUBMISSION_NOT_FOUND'; end if;
  meta:=state.ai_metadata->'instagramPublish';
  if meta->>'outcomeUnknown' is distinct from 'true' then raise exception 'VERIFICATION_NOT_REQUIRED'; end if;
  if exists(select 1 from public.submission_publish_leases where submission_id=p_submission_id and expires_at>now())
     or (meta->>'publishAttemptedAt')::timestamptz>now()-interval '15 minutes' then raise exception 'PUBLISH_IN_PROGRESS'; end if;
  if p_published_media_id is not null and p_published_media_id !~ '^[0-9]+$' then raise exception 'INVALID_MEDIA_ID'; end if;
  perform public.update_submission_instagram_metadata(p_submission_id,'instagramPublish',jsonb_build_object(
    'status',case when p_published_media_id is null then 'failed' else 'published' end,
    'publishedMediaId',p_published_media_id,'permalink',p_permalink,'outcomeUnknown',false,
    'publishedAt',case when p_published_media_id is null then null else now()::text end,
    'lastError',case when p_published_media_id is null then '외부 게시 내역 확인 후 미게시로 확정했어요.' else null end));
  update public.publication_attempts set reconciliation_evidence=p_evidence,reconciled_at=now()
    where content_id=p_submission_id and request_key=coalesce(meta->>'requestedAt','legacy-import');
end $$;
revoke all on function public.reconcile_instagram_publication(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.reconcile_instagram_publication(uuid,text,text,text) to service_role;

create or replace function public.media_usage_summary()
returns jsonb language sql stable security definer set search_path=public as $$
  with inventory as (
    select m.*,case when mime_type like 'image/%' then 'image' when mime_type like 'video/%' then 'video' else 'other' end as kind,
      not (exists(select 1 from public.scene_media r where r.media_asset_id=m.id)
        or exists(select 1 from public.content_outputs r where r.media_asset_id=m.id)
        or exists(select 1 from public.submission_assets r where r.media_asset_id=m.id)
        or exists(select 1 from public.ad_creation_session_assets r where r.media_asset_id=m.id)
        or exists(select 1 from public.exhibition_uploads r where r.media_asset_id=m.id)) as unreferenced
    from public.media_assets m
  ), groups as (
    select provider,kind,count(*) as objects,coalesce(sum(file_size),0) as bytes,
      count(*) filter(where file_size is null) as unknown_size_objects,
      count(*) filter(where unreferenced) as unreferenced_objects,
      coalesce(sum(file_size) filter(where unreferenced),0) as unreferenced_bytes from inventory group by provider,kind
  ) select coalesce(jsonb_agg(to_jsonb(groups) order by provider,kind),'[]'::jsonb) from groups;
$$;
revoke all on function public.media_usage_summary() from public,anon,authenticated;
grant execute on function public.media_usage_summary() to service_role;

notify pgrst, 'reload schema';
commit;
