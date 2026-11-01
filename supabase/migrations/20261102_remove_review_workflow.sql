begin;
-- Preserve submissions and historical review columns; only the active lifecycle changes.
alter table public.submissions drop constraint if exists submissions_status_check;
update public.submissions
set status = case
  when ai_metadata->'instagramPublish'->>'publishedMediaId' is not null
    or ai_metadata->'instagramPublish'->>'publishedAt' is not null then 'published'
  else 'draft' end
where status not in ('draft', 'published');
alter table public.submissions alter column status set default 'draft';
alter table public.submissions add constraint submissions_status_check check (status in ('draft', 'published'));

-- An approval was never proof of an Instagram post. Migrate only workflow labels.
update public.submissions set ai_metadata = jsonb_set(ai_metadata, '{adWorkflow,publishRequestStatus}', '"generated"')
where ai_metadata->'adWorkflow'->>'publishRequestStatus' in ('approved', 'rejected', 'requested_publish');
update public.submissions set ai_metadata = jsonb_set(ai_metadata, '{videoWorkflow,status}', '"generated"')
where ai_metadata->'videoWorkflow'->>'status' in ('approved', 'rejected', 'requested_publish');

-- Abort instead of silently deleting or choosing between existing active jobs.
create unique index if not exists generation_jobs_one_active_per_submission
on public.generation_jobs(submission_id) where status in ('queued', 'processing');
alter table public.generation_jobs drop constraint if exists generation_jobs_style_preset_check;
alter table public.generation_jobs add constraint generation_jobs_style_preset_check
check (style_preset in ('menu_highlight', 'clean_poster', 'market_story', 'food_card_news', 'food_closeup', 'premium'));
commit;
