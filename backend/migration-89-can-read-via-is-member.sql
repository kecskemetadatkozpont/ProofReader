-- ============================================================================
--  Publify — migration 89: make research_can_read/write_project use the VERIFIED
--  research_is_member() helper — guarantees the accepted-member clause.
--
--  WHY (belt-and-suspenders): after migration-86/87 an accepted collaborator can
--  see the project, the keyword-screening funnel, ideas & sources — but NOT the
--  Systematic-Review studio's review-question cards (research_sr_candidates).
--  Those read through research_can_read_project(), the same helper the funnel
--  uses, so the only way both can differ is if that function does not actually
--  carry the member clause in the live DB (migration-87's re-assert may not have
--  taken). research_is_member() was VERIFIED live (migration-86). Rebuild the two
--  helpers ON TOP of it so the member path is guaranteed, without disturbing the
--  owner / student / supervisor logic.
--
--  research_is_member queries ONLY the members table → no research_projects
--  self-reference (migration-12's INSERT..RETURNING bug stays avoided; these
--  helpers are only used by CHILD-table policies anyway). Idempotent; SQL editor.
-- ============================================================================

create or replace function public.research_can_read_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or public.research_is_member(pid)
    or exists (
      select 1 from public.research_projects p where p.id = pid and (
        p.owner_id = auth.uid()
        or exists (select 1 from public.phd_students s where s.id = p.student_id
                   and (s.profile_id = auth.uid() or s.supervisor_id = auth.uid()))
        or exists (select 1 from public.phd_supervisions v
                   where v.student_id = p.student_id and v.supervisor_id = auth.uid() and v.status = 'accepted')
      )
    );
$$;

create or replace function public.research_can_write_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or public.research_is_member(pid, array['owner', 'editor'])
    or exists (select 1 from public.research_projects p where p.id = pid and p.owner_id = auth.uid());
$$;
