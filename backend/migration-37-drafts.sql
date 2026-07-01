-- ============================================================================
--  Publify — migration 37: Writing / draft manuscripts.
--  research_drafts holds an AI-generated draft paper (outline + drafted sections + assembled editor files)
--  built from a project's results + the selected journal. The LaTeX editor imports files → a real project.
-- ============================================================================
create table if not exists research_drafts (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references research_projects(id) on delete cascade,
  journal_pick_id uuid references research_journal_picks(id) on delete set null,
  title           text,
  journal         text,
  outline         jsonb not null default '{}'::jsonb,
  sections        jsonb not null default '[]'::jsonb,
  files           jsonb not null default '{}'::jsonb,   -- {filename: {type, content}} for the editor
  status          text  not null default 'draft',       -- draft | ready | imported
  editor_project_id text,                                -- set once imported into the LaTeX editor
  model           text,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists rdr_project_idx on research_drafts(project_id);
alter table research_drafts enable row level security;
drop policy if exists rdr_read on research_drafts;
create policy rdr_read on research_drafts for select to authenticated using (research_can_read_project(project_id));
drop policy if exists rdr_write on research_drafts;
create policy rdr_write on research_drafts for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));
