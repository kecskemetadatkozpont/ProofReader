-- ============================================================================
--  Publify — migration 35: Protocol (executable research plan).
--  The Protocol stage turns an idea + the study-selected literature into an ORDERED,
--  machine-executable ToDo list. A Claude Code agent on a dedicated machine later
--  claims a 'ready' protocol and runs the steps, writing status/results back.
--  Decisions: one ACTIVE protocol per project; expensive/destructive steps require
--  human approval (needs_approval) before the runner executes them.
--  RLS reuses research_can_read/write_project. The dedicated runner uses the
--  service-role (bypasses RLS) on the trusted machine. Idempotent.
-- ============================================================================

create table if not exists research_protocols (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references research_projects(id) on delete cascade,
  idea_id          uuid references research_ideas(id) on delete set null,
  title            text not null,
  goal             text,                                  -- free-text objective driving generation
  status           text not null default 'draft',         -- draft | ready | running | paused | done | failed | archived
  runner_id        text,                                  -- which dedicated machine should claim this
  repo             jsonb not null default '{}'::jsonb,    -- {url,branch,path}
  env              jsonb not null default '{}'::jsonb,    -- {gpu,conda,notes,secrets_ref}
  context_snapshot jsonb not null default '{}'::jsonb,    -- {idea, included_sources[], datasets[]} captured at generate time
  progress         jsonb not null default '{}'::jsonb,    -- {done,total,current_step,phase} for live UI
  claimed_at       timestamptz,                           -- set when a runner locks it
  heartbeat_at     timestamptz,                           -- runner liveness
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists rprot_project_idx on research_protocols(project_id);
-- at most ONE active (non-terminal) protocol per project; done/archived ones don't block a new one
create unique index if not exists rprot_one_active on research_protocols(project_id) where status not in ('archived','done');

create table if not exists research_protocol_steps (
  id             uuid primary key default gen_random_uuid(),
  protocol_id    uuid not null references research_protocols(id) on delete cascade,
  ord            int  not null,                           -- 1-based order (also the dependency key)
  title          text not null,
  kind           text not null default 'custom',          -- data|preprocess|train|eval|analysis|figure|writeup|custom
  spec           jsonb not null default '{}'::jsonb,      -- {instruction, inputs[], expected_outputs[], acceptance[], command_hint, est_minutes}
  depends_on     int[] not null default '{}',             -- ord indices that must finish first
  needs_approval boolean not null default false,          -- pause for human approval before the runner runs it
  status         text not null default 'todo',            -- todo|queued|running|blocked|done|failed|skipped
  result         jsonb not null default '{}'::jsonb,      -- {log_tail, metrics, artifact_paths[], error}
  attempts       int  not null default 0,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (protocol_id, ord)
);
create index if not exists rpst_protocol_idx on research_protocol_steps(protocol_id, ord);

-- ---- RLS: same pattern as every research_* table ----------------------------
alter table research_protocols enable row level security;
drop policy if exists rprot_read on research_protocols;
create policy rprot_read on research_protocols for select to authenticated using (research_can_read_project(project_id));
drop policy if exists rprot_write on research_protocols;
create policy rprot_write on research_protocols for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));

-- steps have no project_id → join through the protocol for the RLS check
alter table research_protocol_steps enable row level security;
drop policy if exists rpst_read on research_protocol_steps;
create policy rpst_read on research_protocol_steps for select to authenticated
  using (exists (select 1 from research_protocols p where p.id = protocol_id and research_can_read_project(p.project_id)));
drop policy if exists rpst_write on research_protocol_steps;
create policy rpst_write on research_protocol_steps for all to authenticated
  using (exists (select 1 from research_protocols p where p.id = protocol_id and research_can_write_project(p.project_id)))
  with check (exists (select 1 from research_protocols p where p.id = protocol_id and research_can_write_project(p.project_id)));
