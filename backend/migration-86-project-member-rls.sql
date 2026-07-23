-- ============================================================================
--  Publify — migration 86: let accepted collaborators SEE (and editors WRITE)
--  the research_projects ROW.
--
--  BUG: a shared project never appeared in the invitee's list. migration-74 made
--  collaboration work by updating the research_can_read_project / _write_project
--  FUNCTIONS (used by the child tables' policies + the members table) — but the
--  research_projects table's OWN policies were rewritten by migration-12 to read
--  the row's columns directly (owner_id / research_supervises), NOT the function,
--  to dodge an INSERT..RETURNING self-reference bug. So membership was never
--  wired into rp_read/rp_update → an accepted member could read a project's
--  children (ideas, map, messages) but not the project row itself, so it was
--  invisible in the dashboard and the ?project= deep-link couldn't open it.
--
--  FIX: a SECURITY DEFINER membership helper that queries ONLY the members table
--  (a DIFFERENT table → no research_projects self-reference, so migration-12's
--  in-flight-row bug does NOT return; and definer-rights avoid nested members-RLS
--  evaluation inside these policies). OR it into rp_read (any role) and rp_update
--  (owner/editor). A brand-new project has no member row, so the owner path
--  (owner_id = auth.uid()) still covers INSERT..RETURNING. Ownership seizure stays
--  blocked by migration-74's rp_guard_owner trigger.
--  Idempotent; run in the SQL editor. Requires migration-74.
-- ============================================================================

-- true iff auth.uid() is an ACCEPTED member of pid (optionally with one of `roles`)
create or replace function public.research_is_member(pid uuid, roles text[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.research_project_members m
    where m.project_id = pid and m.user_id = auth.uid() and m.accepted
      and (roles is null or m.role = any(roles))
  );
$$;
grant execute on function public.research_is_member(uuid, text[]) to authenticated;

drop policy if exists rp_read on research_projects;
create policy rp_read on research_projects for select to authenticated
  using (is_admin() or owner_id = auth.uid() or research_supervises(student_id) or research_is_member(id));

drop policy if exists rp_update on research_projects;
create policy rp_update on research_projects for update to authenticated
  using (is_admin() or owner_id = auth.uid() or research_is_member(id, array['owner', 'editor']))
  with check (is_admin() or owner_id = auth.uid() or research_is_member(id, array['owner', 'editor']));
