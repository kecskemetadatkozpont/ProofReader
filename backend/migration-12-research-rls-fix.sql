-- ============================================================================
--  Publify — migration 12: fix research_projects RLS for INSERT ... RETURNING.
--  migration-11's rp_read called research_can_read_project(id), which RE-QUERIES
--  research_projects by id. On `insert ... returning` (PostgREST .select()), that
--  STABLE security-definer function can't see the in-flight row in its snapshot, so
--  the SELECT policy fails and Postgres raises 42501 ("new row violates RLS"). Fix:
--  research_projects' OWN policies must read the row's columns DIRECTLY (owner_id),
--  using a helper only for the supervisor check (which queries phd_* — other tables,
--  no self-reference). Run in the SQL editor. Idempotent.
-- ============================================================================

-- supervisor check on a phd_students id — queries phd_* only, safe inside research_projects policies
create or replace function public.research_supervises(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select exists (select 1 from public.phd_students s where s.id = sid and (s.profile_id = auth.uid() or s.supervisor_id = auth.uid()))
        or exists (select 1 from public.phd_supervisions v where v.student_id = sid and v.supervisor_id = auth.uid() and v.status = 'accepted')
  ), false);
$$;

-- research_projects: read/write via the row's own columns (no self-referencing function)
drop policy if exists rp_read on research_projects;
create policy rp_read on research_projects for select to authenticated
  using (is_admin() or owner_id = auth.uid() or research_supervises(student_id));
drop policy if exists rp_update on research_projects;
create policy rp_update on research_projects for update to authenticated
  using (is_admin() or owner_id = auth.uid()) with check (is_admin() or owner_id = auth.uid());
-- rp_insert / rp_delete were already inline (owner_id = auth.uid()) — restate for idempotence
drop policy if exists rp_insert on research_projects;
create policy rp_insert on research_projects for insert to authenticated
  with check (is_admin() or owner_id = auth.uid());
drop policy if exists rp_delete on research_projects;
create policy rp_delete on research_projects for delete to authenticated
  using (is_admin() or owner_id = auth.uid());

-- research_can_read/write_project (used by research_log + research_tasks policies) stay as-is:
-- they query research_projects from a DIFFERENT table's row (the project already exists), so the
-- in-flight-row problem does not apply there.
