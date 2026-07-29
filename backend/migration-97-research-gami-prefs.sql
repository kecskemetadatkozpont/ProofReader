-- ============================================================================
--  Publify — migration 97: per-user, per-project OPT-IN for the cooperative
--  contribution leaderboard (gamification wave 2).
--
--  A user only appears on a project's leaderboard if THEY opted in
--  (leaderboard_optin = true). Ethics guardrails (from the gamification research
--  + adversarial critique): participation is OPT-IN, PROJECT-SCOPED, never
--  global — the board ranks the milestone-weighted contribution the team
--  ALREADY sees in the "Ki mit csinált" activity rollup, so no new
--  cross-project data exposure. There is no global/all-users leaderboard
--  (that would break the strict data isolation of migrations 31/32/33).
--
--  Idempotent; run in the SQL editor. Requires migration-86
--  (research_can_read_project / research_is_member).
-- ============================================================================

create table if not exists public.research_gami_prefs (
  project_id        uuid not null references public.research_projects(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  leaderboard_optin boolean not null default false,
  updated_at        timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table public.research_gami_prefs enable row level security;

-- READ: any member/owner of the project may read all opt-in rows for that project (to render the board).
drop policy if exists gami_read on public.research_gami_prefs;
create policy gami_read on public.research_gami_prefs for select to authenticated
  using (research_can_read_project(project_id));

-- WRITE own row only, and only for a project you can read (are a member/owner of).
drop policy if exists gami_insert_own on public.research_gami_prefs;
create policy gami_insert_own on public.research_gami_prefs for insert to authenticated
  with check (user_id = auth.uid() and research_can_read_project(project_id));

drop policy if exists gami_update_own on public.research_gami_prefs;
create policy gami_update_own on public.research_gami_prefs for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and research_can_read_project(project_id));

drop policy if exists gami_delete_own on public.research_gami_prefs;
create policy gami_delete_own on public.research_gami_prefs for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.research_gami_prefs to authenticated;
