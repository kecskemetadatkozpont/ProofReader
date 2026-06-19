-- ============================================================================
--  Publify — migration 06: let an admin manage publication files on a user's
--  behalf (used by the admin "View as" preview to upload a PDF for a researcher).
--  Normal users stay owner-scoped; only is_admin() gets the wider grant.
--  Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

-- publication_files table already allows admins (policy pubfile_owner has "or is_admin()").
-- Storage was admin-READ only (pubfiles_obj_admin_read) — widen it to full access so an admin
-- can also upload/update/delete objects in the bucket (any owner's folder).
drop policy if exists pubfiles_obj_admin_read on storage.objects;
drop policy if exists pubfiles_obj_admin_all on storage.objects;
create policy pubfiles_obj_admin_all on storage.objects for all to authenticated
  using      (bucket_id = 'publication-files' and is_admin())
  with check (bucket_id = 'publication-files' and is_admin());

-- (The owner policy pubfiles_obj_rw is unchanged: a normal user may only touch
--  files under their own "<user_id>/…" prefix.)
