-- ============================================================================
--  Publify — migration 96: storage bucket for DM file attachments.
--
--  Files sent in a person-to-person / group conversation live in a dedicated
--  private bucket, path = <thread_id>/<filename>. Access is gated by thread
--  membership (dm_is_member, migration-94) via the first path segment — the same
--  pattern the research-data bucket uses for project_id (migration-15). Reuses the
--  safe_uuid() helper from migration-15.
--
--  Additive + idempotent. Run in the Supabase SQL editor. (safe_uuid + dm_is_member
--  must already exist — migration-15 + migration-94.)
-- ============================================================================

insert into storage.buckets (id, name, public) values ('dm-files', 'dm-files', false)
  on conflict (id) do nothing;

drop policy if exists dm_files_read on storage.objects;
create policy dm_files_read on storage.objects for select to authenticated
  using (bucket_id = 'dm-files' and public.dm_is_member(public.safe_uuid((storage.foldername(name))[1])));

drop policy if exists dm_files_insert on storage.objects;
create policy dm_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'dm-files' and public.dm_is_member(public.safe_uuid((storage.foldername(name))[1])));

drop policy if exists dm_files_delete on storage.objects;
create policy dm_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dm-files' and public.dm_is_member(public.safe_uuid((storage.foldername(name))[1])));
