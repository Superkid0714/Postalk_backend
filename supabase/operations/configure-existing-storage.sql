-- Preserve the existing private bucket and every object; change upload limits only.
begin;
do $$ begin
 if not exists(select 1 from storage.buckets where id='uploads' and public=false) then
  raise exception 'EXPECTED_PRIVATE_UPLOADS_BUCKET_MISSING';
 end if;
end $$;
update storage.buckets set file_size_limit=52428800,
 allowed_mime_types=array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm']
where id='uploads' and public=false;
commit;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='uploads';
