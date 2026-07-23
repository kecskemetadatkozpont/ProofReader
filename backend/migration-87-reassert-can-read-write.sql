-- ============================================================================
--  Publify — migration 87: re-assert research_can_read_project / _write_project
--  with the accepted-member clause.
--
--  SYMPTOM: an accepted collaborator can see the shared project ROW (fixed in
--  migration-86 via research_is_member in rp_read) but NOT its Study cards — nor,
--  by the same mechanism, its ideas / sources / messages / protocols / datasets /
--  map, because EVERY research child table's RLS reads through these two helper
--  functions (e.g. rst_read = research_can_read_project(project_id)).
--
--  ROOT CAUSE: migration-74 was supposed to add the member clause to these two
--  functions, but the DB still behaves as migration-11's owner/student/supervisor
--  only version (the members TABLE + accept RPC applied — invite/accept work —
--  but the function bodies did not take). Re-assert the intended (migration-74)
--  definitions verbatim. This is the LATEST version (no later migration changes
--  them) so there is no regression, and `create or replace` is idempotent.
--
--  NOTE: these functions query research_projects, but only from a CHILD table's
--  policy (the project already exists) — so migration-12's INSERT..RETURNING
--  self-reference problem does NOT apply here (that was research_projects' OWN
--  rp_read, which now uses research_is_member from migration-86).
--  Run in the SQL editor. Requires migration-74 (research_project_members).
-- ============================================================================

create or replace function public.research_can_read_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.research_projects p where p.id = pid and (
      public.is_admin() or p.owner_id = auth.uid()
      or exists (select 1 from public.phd_students s where s.id = p.student_id
                 and (s.profile_id = auth.uid() or s.supervisor_id = auth.uid()))
      or exists (select 1 from public.phd_supervisions v
                 where v.student_id = p.student_id and v.supervisor_id = auth.uid() and v.status = 'accepted')
      or exists (select 1 from public.research_project_members m
                 where m.project_id = p.id and m.user_id = auth.uid() and m.accepted)
    )
  );
$$;

create or replace function public.research_can_write_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.research_projects p where p.id = pid
      and (
        public.is_admin() or p.owner_id = auth.uid()
        or exists (select 1 from public.research_project_members m
                   where m.project_id = p.id and m.user_id = auth.uid() and m.accepted
                     and m.role in ('owner', 'editor'))
      )
  );
$$;
