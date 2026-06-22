-- migration-33 (LOCKDOWN — apply only AFTER the migration-32 + repointed client is live): restrict the
-- profiles base table to own row + admin. Cross-user name/avatar now comes from profiles_public, the
-- supervisor directory from supervisors_public, and collaborator search from pr_search_users() — so no
-- client path needs cross-user base-table reads. This stops any user from reading another user's email,
-- role, status, affiliation, MTMT/ORCID, cost center, ai_model, etc.
drop policy if exists read_profiles on public.profiles;
create policy read_own_profile on public.profiles for select using (id = auth.uid());
-- (admin_all_profiles `for all using (is_admin())` already grants admins full SELECT.)
