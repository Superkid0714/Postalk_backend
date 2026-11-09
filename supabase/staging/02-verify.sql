-- After schema.sql, run in the SAME new staging project.
-- Temporary fixtures are rolled back. No Storage, AI, or Instagram calls.
begin;
do $$
declare table_name text; rpc text; selected_store uuid; creation uuid:=gen_random_uuid(); asset uuid:=gen_random_uuid();
  input jsonb; ad jsonb; normalized_count integer;
begin
  foreach table_name in array array[
    'users','stores','submissions','submission_assets','generation_jobs','generation_job_leases','submission_publish_leases',
    'ad_creation_sessions','ad_creation_session_assets','merchant_qr_tokens','qr_entry_slots','exhibition_uploads',
    'input_templates','script_jobs','contents','concept_versions','creation_sessions','creation_scenes','media_assets','scene_media','content_outputs','publication_attempts'
  ] loop
    if not exists(select 1 from pg_class where oid=to_regclass('public.'||table_name) and relkind='r' and relrowsecurity) then
      raise exception 'MISSING_TABLE_OR_RLS: %',table_name;
    end if;
    if has_table_privilege('anon','public.'||table_name,'select,insert,update,delete')
       or has_table_privilege('authenticated','public.'||table_name,'select,insert,update,delete') then
      raise exception 'DIRECT_CLIENT_ACCESS: %',table_name;
    end if;
    if not has_table_privilege('service_role','public.'||table_name,'select') then raise exception 'SERVER_ACCESS_MISSING: %',table_name; end if;
  end loop;
  foreach table_name in array array['exhibition_templates','exhibition_script_jobs','exhibition_ads'] loop
    if not exists(select 1 from pg_class where oid=to_regclass('public.'||table_name) and relkind='v' and 'security_invoker=true'=any(reloptions)) then
      raise exception 'COMPATIBILITY_VIEW_INVALID: %',table_name;
    end if;
    if has_table_privilege('anon','public.'||table_name,'select') or has_table_privilege('authenticated','public.'||table_name,'select') then raise exception 'VIEW_ACCESS_LEAK: %',table_name; end if;
  end loop;
  foreach rpc in array array[
    'create_exhibition_ad(uuid,jsonb,text,uuid[],jsonb)','register_exhibition_upload(jsonb)',
    'update_exhibition_caption(uuid,uuid,text)','delete_exhibition_ad(uuid,uuid)','retry_exhibition_generation(uuid,uuid)',
    'ensure_creation_session(uuid,uuid,jsonb)','media_usage_summary()',
    'reconcile_instagram_publication(uuid,text,text,text)'
  ] loop
    if to_regprocedure('public.'||rpc) is null then raise exception 'RPC_MISSING: %',rpc; end if;
    if has_function_privilege('anon','public.'||rpc,'execute') or has_function_privilege('authenticated','public.'||rpc,'execute') then raise exception 'PUBLIC_RPC_ACCESS: %',rpc; end if;
    if not has_function_privilege('service_role','public.'||rpc,'execute') then raise exception 'SERVER_RPC_ACCESS_MISSING: %',rpc; end if;
  end loop;
  if to_regclass('public.generation_jobs_one_active_per_submission') is null or to_regclass('public.publication_attempts_one_pending_or_published') is null then raise exception 'CONCURRENCY_INDEX_MISSING'; end if;

  insert into public.stores(market_name,store_name) values('__staging_check__','temporary-'||creation::text) returning id into selected_store;
  input:=jsonb_build_object('creationId',creation,'format','card_news','conceptId','staging-check','storeDescription','테스트 가게',
    'menus',jsonb_build_array(jsonb_build_object('id','menu-1','name','테스트 메뉴','description','테스트 설명')),
    'template',jsonb_build_object('id','staging-check','version','1','renderer','source-photo-v1','usesSubtitles',false,'maxSubtitleChars',40,
      'scenes',jsonb_build_array(jsonb_build_object('sceneNumber',1,'target','메뉴','menuId','menu-1','mediaType','image','durationSeconds',3))));
  perform public.register_exhibition_upload(jsonb_build_object('id',asset,'store_id',selected_store,'creation_id',creation,
    'scene_number',1,'menu_id','menu-1','media_type','image','storage_bucket','uploads','file_path','staging-check/'||asset::text||'.png','mime_type','image/png','file_size',100));
  ad:=public.create_exhibition_ad(selected_store,input,'staging-digest',array[asset],'[]'::jsonb);
  if public.create_exhibition_ad(selected_store,input,'staging-digest',array[asset],'[]'::jsonb)->>'adId'<>ad->>'adId' then raise exception 'IDEMPOTENCY_FAILED'; end if;
  select count(*) into normalized_count from public.contents c join public.creation_sessions s on s.id=c.session_id
    join public.generation_jobs j on j.content_id=c.id and j.id=c.job_id
    join public.creation_scenes scene on scene.session_id=s.id join public.scene_media sm on sm.scene_id=scene.id
    join public.media_assets m on m.id=sm.media_asset_id and m.store_id=c.store_id where c.id=(ad->>'adId')::uuid;
  if normalized_count<>1 then raise exception 'WORKFLOW_LINKS_INVALID'; end if;
  update public.generation_jobs set status='completed' where id=(ad->>'jobId')::uuid;
  perform public.update_exhibition_caption((ad->>'adId')::uuid,selected_store,'테스트 캡션');
  perform public.delete_exhibition_ad((ad->>'adId')::uuid,selected_store);
  if not exists(select 1 from public.contents where id=(ad->>'adId')::uuid and deleted_at is not null) then raise exception 'SOFT_DELETE_FAILED'; end if;
end $$;
select 'PASS: tables, RLS, server grants, compatibility views, RPCs, idempotence, workflow, caption, soft delete' as result;
rollback;
