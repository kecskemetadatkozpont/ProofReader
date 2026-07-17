-- ============================================================================
--  Publify — migration 77: supervisor sign-off (cooperative Phase 4)
--
--  migration-75 added step sign-off, but writing research_protocol_steps requires project
--  WRITE access — so a read-only SUPERVISOR could not sign off a step. Supervisor sign-off
--  is exactly the academic use case (the advisor approves a step). This adds a SECURITY
--  DEFINER RPC that lets an editor/owner/admin OR a supervisor set/clear a step's sign-off,
--  WITHOUT granting supervisors general write access to research_protocol_steps.
--
--  research_step_signoff(step_id, clear) — records auth.uid() as signed_off_by (+ now()),
--  or clears both when clear=true. Authorization: admin, project writer, or supervisor of
--  the step's project. Idempotent. Requires migration-75 (the sign-off columns).
-- ============================================================================

-- is the caller a supervisor of the project (mirrors the read-gate supervisor branches)?
create or replace function public.research_is_supervisor(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.research_projects p where p.id = pid and (
      exists (select 1 from public.phd_students s where s.id = p.student_id and s.supervisor_id = auth.uid())
      or exists (select 1 from public.phd_supervisions v
                 where v.student_id = p.student_id and v.supervisor_id = auth.uid() and v.status = 'accepted')
    )
  );
$$;

create or replace function public.research_step_signoff(step_id uuid, clear boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select pr.project_id into pid
    from public.research_protocol_steps st
    join public.research_protocols pr on pr.id = st.protocol_id
    where st.id = step_id;
  if pid is null then raise exception 'step not found'; end if;
  if not (public.is_admin() or public.research_can_write_project(pid) or public.research_is_supervisor(pid)) then
    raise exception 'not authorized to sign off this step';
  end if;
  update public.research_protocol_steps
    set signed_off_by = case when clear then null else auth.uid() end,
        signed_off_at = case when clear then null else now() end
    where id = step_id;
end;
$$;
