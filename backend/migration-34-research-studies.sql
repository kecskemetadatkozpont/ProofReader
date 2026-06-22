-- ============================================================================
--  Publify — migration 34: Literature Study Workflow (Elicit-style 4-step funnel).
--  A study funnels papers (research_sources, dedup by ext_id) through 4 steps with
--  per-(study,source,step) decisions. Step config is editable between runs. Step N
--  only processes step N-1 includes. RLS reuses research_can_read/write_project.
--  Idempotent.
-- ============================================================================

create table if not exists research_studies (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references research_projects(id) on delete cascade,
  idea_id     uuid references research_ideas(id) on delete set null,   -- "Start from idea"
  title       text not null,
  question    text,                                  -- snapshot of the idea question at start
  status      text not null default 'active',        -- active | done | archived
  cur_step    int  not null default 1,               -- furthest step reached (UI convenience)
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists rst_project_idx on research_studies(project_id);

create table if not exists research_study_steps (
  id          uuid primary key default gen_random_uuid(),
  study_id    uuid not null references research_studies(id) on delete cascade,
  step        int  not null,                         -- 1=quick 2=abstract 3=fulltext 4=review
  kind        text not null,                         -- quick | abstract | fulltext | review
  config      jsonb not null default '{}'::jsonb,    -- {keywords[],include[],exclude[],filters{},signals[],source_adapter,max_results}
  status      text not null default 'pending',       -- pending | running | done
  cursor      int  not null default 0,               -- batch cursor (resumability)
  total       int  not null default 0,               -- candidate count for this step
  counts      jsonb not null default '{}'::jsonb,    -- {include,maybe,exclude,error}
  last_run_at timestamptz,
  unique (study_id, step)
);
create index if not exists rsts_study_idx on research_study_steps(study_id);

create table if not exists research_study_papers (
  id          uuid primary key default gen_random_uuid(),
  study_id    uuid not null references research_studies(id) on delete cascade,
  source_id   uuid not null references research_sources(id) on delete cascade,
  step        int  not null,                         -- the step this decision belongs to
  decision    text not null default 'unscreened',    -- unscreened | include | maybe | exclude
  reason      text,                                  -- one-line justification
  score       int,                                   -- 0..100 relevance
  signals     jsonb not null default '{}'::jsonb,    -- {has_github,has_dataset,oa_pdf,screened_on:'pdf'|'abstract'}
  overridden  boolean not null default false,        -- a human flipped the AI decision
  created_at  timestamptz not null default now(),
  unique (study_id, source_id, step)                 -- one decision per paper per step → the funnel
);
create index if not exists rstp_study_step_idx on research_study_papers(study_id, step);
create index if not exists rstp_source_idx on research_study_papers(source_id);

-- ---- RLS: same pattern as every research_* table -----------------------------
alter table research_studies enable row level security;
drop policy if exists rst_read on research_studies;
create policy rst_read on research_studies for select to authenticated using (research_can_read_project(project_id));
drop policy if exists rst_write on research_studies;
create policy rst_write on research_studies for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));

-- steps/papers have no project_id → join through the study for the RLS check
alter table research_study_steps enable row level security;
drop policy if exists rsts_read on research_study_steps;
create policy rsts_read on research_study_steps for select to authenticated
  using (exists (select 1 from research_studies s where s.id = study_id and research_can_read_project(s.project_id)));
drop policy if exists rsts_write on research_study_steps;
create policy rsts_write on research_study_steps for all to authenticated
  using (exists (select 1 from research_studies s where s.id = study_id and research_can_write_project(s.project_id)))
  with check (exists (select 1 from research_studies s where s.id = study_id and research_can_write_project(s.project_id)));

alter table research_study_papers enable row level security;
drop policy if exists rstp_read on research_study_papers;
create policy rstp_read on research_study_papers for select to authenticated
  using (exists (select 1 from research_studies s where s.id = study_id and research_can_read_project(s.project_id)));
drop policy if exists rstp_write on research_study_papers;
create policy rstp_write on research_study_papers for all to authenticated
  using (exists (select 1 from research_studies s where s.id = study_id and research_can_write_project(s.project_id)))
  with check (exists (select 1 from research_studies s where s.id = study_id and research_can_write_project(s.project_id)));
