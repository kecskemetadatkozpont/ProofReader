-- ============================================================================
--  Publify — migration 62: Autopilot run-state (P2)
--
--  Backs the client-driven Autopilot orchestrator (autopilot.js): a `run` holds
--  the phase pipeline + cursors + gates; `events` is the live activity feed the
--  dashboard renders. All edge functions (research-ai/study/journals/protocol/
--  writing) require the caller's USER JWT, so orchestration runs in the browser
--  (the dashboard tab) under the user's session — these tables just persist the
--  run so it is resumable and viewable live via Realtime.
--
--  RLS mirrors the research_* convention exactly: project-scoped via the existing
--  research_can_read_project / research_can_write_project SECURITY DEFINER helpers
--  (migration-11). Apply in the Supabase SQL editor.
-- ============================================================================

-- ---- 1. runs ---------------------------------------------------------------
create table if not exists research_autopilot_runs (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references research_projects(id) on delete cascade,
  owner_id     uuid not null default auth.uid() references profiles(id) on delete cascade,
  status       text not null default 'queued',      -- queued|running|awaiting_approval|paused|done|failed|cancelled
  phase_index  int  not null default 0,
  phases       jsonb not null default '[]'::jsonb,   -- [{key,label,enabled,status,result,cursor}]
  config       jsonb not null default '{}'::jsonb,   -- {tier,max_papers,gates}
  gate         jsonb,                                 -- {phase,title,detail} while status='awaiting_approval'
  study_id     uuid,                                  -- research_studies row created for the Literature phase
  protocol_id  uuid,                                  -- research_protocols row created for the Protocol phase
  error        text,
  driver_token uuid,                                  -- single-driver lease: the browser tab currently advancing this run
  driver_beat  timestamptz,                           -- lease heartbeat; a lease not renewed for >30s is stealable by another tab
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create index if not exists rar_project_idx on research_autopilot_runs(project_id, created_at desc);
create index if not exists rar_owner_idx   on research_autopilot_runs(owner_id);

-- ---- 2. events (activity feed) --------------------------------------------
create table if not exists research_autopilot_events (
  id         bigint generated always as identity primary key,
  run_id     uuid not null references research_autopilot_runs(id) on delete cascade,
  project_id uuid not null references research_projects(id) on delete cascade,
  phase      text,
  level      text not null default 'run',            -- run|ok|warn|sys|error
  message    text not null,
  created_at timestamptz not null default now()
);
create index if not exists rae_run_idx on research_autopilot_events(run_id, id);

-- ---- 3. RLS (project-scoped, same helpers as research_log/research_tasks) --
alter table research_autopilot_runs enable row level security;

drop policy if exists rar_read on research_autopilot_runs;
create policy rar_read on research_autopilot_runs for select to authenticated
  using (research_can_read_project(project_id));
drop policy if exists rar_insert on research_autopilot_runs;
create policy rar_insert on research_autopilot_runs for insert to authenticated
  with check (research_can_write_project(project_id) and owner_id = auth.uid());
drop policy if exists rar_update on research_autopilot_runs;
create policy rar_update on research_autopilot_runs for update to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));
drop policy if exists rar_delete on research_autopilot_runs;
create policy rar_delete on research_autopilot_runs for delete to authenticated
  using (is_admin() or owner_id = auth.uid());

alter table research_autopilot_events enable row level security;

drop policy if exists rae_read on research_autopilot_events;
create policy rae_read on research_autopilot_events for select to authenticated
  using (research_can_read_project(project_id));
drop policy if exists rae_insert on research_autopilot_events;
create policy rae_insert on research_autopilot_events for insert to authenticated
  with check (research_can_write_project(project_id));
drop policy if exists rae_delete on research_autopilot_events;
create policy rae_delete on research_autopilot_events for delete to authenticated
  using (is_admin() or research_can_write_project(project_id));

-- ---- 4. Realtime (dashboard subscribes to run + event changes) -------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'research_autopilot_runs') then
    alter publication supabase_realtime add table research_autopilot_runs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'research_autopilot_events') then
    alter publication supabase_realtime add table research_autopilot_events;
  end if;
end $$;
