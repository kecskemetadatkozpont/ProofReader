-- ============================================================================
--  Publify — migration 74: cooperative work Phase 1 — project members & roles
--
--  ⚠️  SECURITY-SENSITIVE: this migration CHANGES research_can_write_project and
--      research_can_read_project so that accepted COLLABORATORS gain access to a
--      project. Review it before applying. Until it is applied the app degrades to the
--      current behavior (owner-only writes; no members UI).
--
--  What it adds:
--   * research_project_members(project_id, user_id, role, accepted, invited_by, created_at)
--     role ∈ owner | editor | commenter | viewer.
--   * research_can_read_project  — now ALSO true for any ACCEPTED member (any role).
--   * research_can_write_project — now ALSO true for an accepted member whose role is
--     owner or editor. (commenter/viewer stay read-only; the existing owner/admin/
--     student/supervisor logic is preserved verbatim — membership is OR-ed in.)
--   * research_member_accept(pid) — SECURITY DEFINER RPC so an invitee can accept THEIR
--     OWN invite (sets accepted=true) without being able to change their role.
--
--  RLS on the members table: read = project readers; insert/update/delete = the project
--  OWNER or an admin (team management is an owner action). Realtime enabled. Idempotent.
-- ============================================================================

create table if not exists research_project_members (
  project_id uuid not null references research_projects(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       text not null default 'viewer' check (role in ('owner', 'editor', 'commenter', 'viewer')),
  invited_by uuid default auth.uid() references profiles(id) on delete set null,
  accepted   boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists rpm_project_idx on research_project_members(project_id);
create index if not exists rpm_user_idx on research_project_members(user_id);

-- ---- access helpers: preserve the existing logic, OR-in accepted membership ----
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

-- ---- RLS on the members table ----
alter table research_project_members enable row level security;

drop policy if exists rpm_read on research_project_members;
create policy rpm_read on research_project_members for select to authenticated
  using (research_can_read_project(project_id));

-- only the project owner (or an admin) manages the team
drop policy if exists rpm_insert on research_project_members;
create policy rpm_insert on research_project_members for insert to authenticated
  with check (is_admin() or exists (select 1 from research_projects p where p.id = project_id and p.owner_id = auth.uid()));

drop policy if exists rpm_update on research_project_members;
create policy rpm_update on research_project_members for update to authenticated
  using (is_admin() or exists (select 1 from research_projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (is_admin() or exists (select 1 from research_projects p where p.id = project_id and p.owner_id = auth.uid()));

drop policy if exists rpm_delete on research_project_members;
create policy rpm_delete on research_project_members for delete to authenticated
  using (is_admin() or exists (select 1 from research_projects p where p.id = project_id and p.owner_id = auth.uid()));

-- an invitee accepts THEIR OWN invite (cannot change role) via this RPC
create or replace function public.research_member_accept(pid uuid) returns void
language sql volatile security definer set search_path = public as $$
  update public.research_project_members set accepted = true
    where project_id = pid and user_id = auth.uid();
$$;

-- ---- CRITICAL: guard project ownership transfer ----------------------------------
-- Because this migration grants accepted editors write access, they now satisfy the
-- research_projects rp_update RLS policy (migration-11: using/with-check
-- research_can_write_project, with NO column restriction). Without this guard an editor
-- could `update research_projects set owner_id = <self>` and seize the project (then
-- manage/delete it). RLS WITH CHECK cannot enforce this (it sees only the NEW row, not
-- OLD), so we use a BEFORE UPDATE trigger: only the CURRENT owner or an admin may change
-- owner_id or student_id (the access-defining columns). Editors keep write access to all
-- normal columns (title, keywords, stage, nodes/tasks/log, …).
create or replace function public.research_guard_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is distinct from old.owner_id
     and not (public.is_admin() or auth.uid() = old.owner_id) then
    raise exception 'only the current owner or an admin may transfer ownership';
  end if;
  if new.student_id is distinct from old.student_id
     and not (public.is_admin() or auth.uid() = old.owner_id) then
    raise exception 'only the current owner or an admin may change the linked student';
  end if;
  return new;
end;
$$;
drop trigger if exists rp_guard_owner on research_projects;
create trigger rp_guard_owner before update on research_projects
  for each row execute function public.research_guard_owner();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'research_project_members') then
    alter publication supabase_realtime add table research_project_members;
  end if;
end $$;
