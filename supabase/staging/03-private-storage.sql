-- Optional Storage setup for stage 2 API tests, ONLY in the new staging project.
-- No existing bucket is changed. 50 MiB bucket limit; the project-wide limit also applies.
begin;
do $$ begin
  if exists(select 1 from storage.buckets where id='uploads') then
    raise exception 'BUCKET_ALREADY_EXISTS: inspect its privacy and limits manually';
  end if;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('uploads','uploads',false,52428800,array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm']);
commit;
