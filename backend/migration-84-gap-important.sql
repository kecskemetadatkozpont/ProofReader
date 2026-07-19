-- ============================================================================
--  Publify — migration 84: supervisor gap-approval ("⭐ Fontos")
--
--  Lets a supervisor (or editor/owner/admin) flag a research gap as important/approved.
--  A gap is a research_ideas row (source='gap', migration-83). Writing research_ideas
--  needs project WRITE access, so a read-only SUPERVISOR could not flag one — this adds a
--  SECURITY DEFINER RPC (mirrors research_step_signoff, migration-77) so a supervisor can
--  set/clear the flag WITHOUT general write access. Additive column; no RLS change.
-- ============================================================================

alter table public.research_ideas add column if not exists gap_important boolean not null default false;
comment on column public.research_ideas.gap_important is 'supervisor/editor "important/approved" flag on a gap (migration-84)';

-- set/clear the important flag on a gap. Authorization: admin, project writer, or supervisor.
create or replace function public.research_gap_set_important(gap_id uuid, val boolean) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select i.project_id into pid from public.research_ideas i where i.id = gap_id and i.source = 'gap';
  if pid is null then raise exception 'gap not found'; end if;
  if not (public.is_admin() or public.research_can_write_project(pid) or public.research_is_supervisor(pid)) then
    raise exception 'not authorized to flag this gap';
  end if;
  update public.research_ideas set gap_important = coalesce(val, false) where id = gap_id;
end;
$$;
