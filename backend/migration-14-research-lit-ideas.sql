-- ============================================================================
--  Publify — migration 14: Research R1 (ideas + literature library).
--  research_ideas (candidate questions/hypotheses from own idea / publications /
--  gap analysis / Consensus) and research_sources (the screened literature library,
--  populated from OpenAlex/Consensus/Elicit/manual). RLS reuses research_can_read/
--  write_project (other-table reads — no INSERT...RETURNING self-reference issue).
--  Run in the SQL editor. Idempotent.
-- ============================================================================

create table if not exists research_ideas (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references research_projects(id) on delete cascade,
  source      text not null default 'own',     -- own | publications | gap | consensus
  question    text not null,
  hypothesis  text,
  rationale   text,
  novelty     int,                              -- 0..100 (optional, AI-estimated)
  status      text not null default 'candidate',-- candidate | selected | rejected
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists ri_project_idx on research_ideas(project_id);

create table if not exists research_sources (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references research_projects(id) on delete cascade,
  source_api  text not null default 'manual',   -- openalex | consensus | elicit | manual
  ext_id      text,                              -- e.g. OpenAlex work id (for dedup)
  doi         text,
  title       text not null,
  authors     text[],
  year        int,
  venue       text,
  abstract    text,
  cited_by    int,
  url         text,
  screening   text not null default 'unscreened', -- unscreened | include | maybe | exclude
  notes       text,
  created_at  timestamptz not null default now(),
  unique (project_id, ext_id)
);
create index if not exists rs_project_idx on research_sources(project_id);

-- ---- RLS (read = can-read project, write = can-write project) ---------------
alter table research_ideas enable row level security;
drop policy if exists ri_read on research_ideas;
create policy ri_read on research_ideas for select to authenticated using (research_can_read_project(project_id));
drop policy if exists ri_write on research_ideas;
create policy ri_write on research_ideas for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));

alter table research_sources enable row level security;
drop policy if exists rs_read on research_sources;
create policy rs_read on research_sources for select to authenticated using (research_can_read_project(project_id));
drop policy if exists rs_write on research_sources;
create policy rs_write on research_sources for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));
