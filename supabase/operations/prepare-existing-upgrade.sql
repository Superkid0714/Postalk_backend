-- Run BEFORE the 20261102 workflow migrations on a populated legacy project.
-- No table rows are exported or deleted. Run within the same outer transaction
-- as the remaining migrations. Save only old technical workflow labels in place.
do $$ begin
  if exists(select 1 from public.generation_jobs where status in ('queued','processing') and updated_at>=now()-interval '7 days') then
    raise exception 'RECENT_GENERATION_WORK: stop the worker and inspect pending work before upgrade';
  end if;
  if exists(select 1 from public.submissions where ai_metadata is not null and jsonb_typeof(ai_metadata)<>'object') then
    raise exception 'METADATA_SHAPE_INVALID';
  end if;
end $$;

update public.submissions set ai_metadata=coalesce(ai_metadata,'{}'::jsonb)||jsonb_build_object('merchantWorkflowMigration',
  jsonb_build_object('previousStatus',status,'previousPhotoStatus',ai_metadata->'adWorkflow'->'publishRequestStatus',
    'previousVideoStatus',ai_metadata->'videoWorkflow'->'status','previousUpdatedAt',updated_at,'migratedAt',now()))
where not (coalesce(ai_metadata,'{}'::jsonb)?'merchantWorkflowMigration') and
  (status not in ('draft','published') or ai_metadata->'adWorkflow'->>'publishRequestStatus' in ('approved','rejected','requested_publish')
   or ai_metadata->'videoWorkflow'->>'status' in ('approved','rejected','requested_publish'));

-- Never automatically restart old paid provider requests after a long pause.
-- Preserve provider operation data and the prior technical state for inspection.
update public.generation_jobs set result_payload=coalesce(result_payload,'{}'::jsonb)||jsonb_build_object('legacyRecoveryState',
  jsonb_build_object('previousStatus',status,'previousFailureReason',failure_reason,'previousUpdatedAt',updated_at,'preservedAt',now())),
  status='failed',failure_reason='장기간 중단된 이전 작업입니다. 자동 재호출하지 않으며 필요하면 새 제작으로 시작해 주세요.'
where status in ('queued','processing') and updated_at<now()-interval '7 days';
