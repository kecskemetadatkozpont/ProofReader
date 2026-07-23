-- ============================================================================
--  Publify — migration 88: share the Systematic-Review studio with collaborators.
--
--  BUG: the SR studio cards (a project's `elicit_jobs` rows, kind='sysreview' /
--  'report') were invisible to an accepted collaborator. elicit_jobs (migration-51,
--  which predates collaboration) has a project_id but its RLS is USER-scoped
--  (`user_id = auth.uid() or is_admin()`) — it never got the project-scoped
--  treatment the research_* child tables use. So a member of the project could
--  not read the SR jobs even though everything else in the project is now shared.
--
--  FIX: read = the creator, an admin, OR any READER of the linked project;
--  write = the creator, an admin, OR an EDITOR of the linked project. Jobs with a
--  NULL project_id stay private to their creator (no behavior change). Preserves
--  the existing user_id / admin access. Idempotent; run in the SQL editor.
--  Requires migration-74 (+ migration-87 so research_can_read/write_project carry
--  the member clause).
-- ============================================================================

alter table public.elicit_jobs enable row level security;

drop policy if exists elicit_jobs_own on public.elicit_jobs;
drop policy if exists elicit_jobs_read on public.elicit_jobs;
drop policy if exists elicit_jobs_write on public.elicit_jobs;

-- READ: creator / admin / any reader of the linked project (collaborators)
create policy elicit_jobs_read on public.elicit_jobs for select to authenticated
  using (
    user_id = auth.uid() or public.is_admin()
    or (project_id is not null and public.research_can_read_project(project_id))
  );

-- WRITE (insert/update/delete): creator / admin / an editor of the linked project
create policy elicit_jobs_write on public.elicit_jobs for all to authenticated
  using (
    user_id = auth.uid() or public.is_admin()
    or (project_id is not null and public.research_can_write_project(project_id))
  )
  with check (
    user_id = auth.uid() or public.is_admin()
    or (project_id is not null and public.research_can_write_project(project_id))
  );
