-- ============================================================================
--  Publify — migration 58: ensure admins can write OTHER users' profiles
--
--  Symptom: from the Admin panel, toggling a user's feature (profiles.features)
--  appeared to do nothing — the row never changed and the user never gained the
--  feature. Cause: the only effective UPDATE policy on profiles is
--  write_own_profile (id = auth.uid()); an admin's UPDATE of another user's row
--  matches 0 rows under RLS and returns NO error (a silent no-op). The intended
--  admin_all_profiles policy (migration-03, `for all using is_admin()`) — which
--  migration-33's lockdown relies on — is re-asserted here so it is definitely
--  present. Idempotent — safe to re-run.
--
--  After applying: an admin can set profiles.features / model_allowlist / status /
--  ai_model / can_workflows / can_figures for any user. The guard_profile_update
--  trigger (migration-49) still returns admin writes unchanged, and still locks
--  those columns for non-admins — so this does NOT let users self-grant.
-- ============================================================================

drop policy if exists admin_all_profiles on public.profiles;
create policy admin_all_profiles on public.profiles for all
  using (public.is_admin()) with check (public.is_admin());

-- Verify (as an admin session, or check the catalog):
--   select polname, cmd from pg_policies where tablename = 'profiles';   -- expect admin_all_profiles (ALL)
