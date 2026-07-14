-- ============================================================================
--  Publify — migration 63: Pipeline Canvas ("Map") free-drag layout persistence
--
--  The Map (research.jsx PipelineCanvas) used to compute every node's position
--  deterministically on each render (swimlane / freeform auto-layout). Users want
--  to freely rearrange the cards and have that arrangement stick. This table
--  persists a per-node {x,y} for a project; the Map applies a saved position as an
--  override on top of the auto-layout, and pins saved nodes so the built-in
--  no-overlap rule only tucks in NEW (never-placed) cards without shoving the
--  user's own arrangement. node_id is the materializer's stable node id
--  ('i'<idea>, 'p'<source>, 'lit', 'sr', 'r'<step>, 'v'<journal>, 'w'<file>, …).
--
--  RLS mirrors the research_* convention exactly (migration-11 helpers). Realtime
--  so a second tab / future collaborator sees moves live. Apply in the Supabase
--  SQL editor. Idempotent.
-- ============================================================================

create table if not exists research_map_layout (
  project_id uuid not null references research_projects(id) on delete cascade,
  node_id    text not null,
  x          real not null,
  y          real not null,
  updated_by uuid default auth.uid() references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (project_id, node_id)
);
create index if not exists rml_project_idx on research_map_layout(project_id);

alter table research_map_layout enable row level security;

-- read: anyone who can read the project (includes viewers)
drop policy if exists rml_read on research_map_layout;
create policy rml_read on research_map_layout for select to authenticated
  using (research_can_read_project(project_id));

-- write (insert/update/delete): only project editors
drop policy if exists rml_write on research_map_layout;
create policy rml_write on research_map_layout for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));

-- Realtime: the Map subscribes to layout changes (project-filtered)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'research_map_layout') then
    alter publication supabase_realtime add table research_map_layout;
  end if;
end $$;
