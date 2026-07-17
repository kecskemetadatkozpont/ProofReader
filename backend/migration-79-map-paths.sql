-- ============================================================================
--  Publify — migration 79: Map story paths (Prezi-mode Phase 2 — presentation/tour)
--
--  A "path" is an ordered guided tour of the research Map for supervisor walkthroughs /
--  thesis defense / onboarding. It is a single row with a JSONB `steps` array of beats;
--  each beat targets a saved page / a frame / a node / a free viewport, with a caption,
--  presenter notes, an optional "open this card's panel" flag, and a dwell time. The camera
--  flies (flyTo) beat-to-beat. RLS + realtime are cloned verbatim from research_map_pages
--  (migration-73): read = project readers, write = editors.
--
--  steps[i] = {
--    kind: 'page'|'frame'|'node'|'view',
--    ref_id: text,            -- page/frame/node id (the LIVE target; falls back to tx/ty/k if gone)
--    tx, ty, k: real,         -- snapshot viewport (fallback + for kind 'view')
--    enter_panel: bool,       -- open the node's workflow panel at this beat (node beats)
--    panel_tab: text,         -- resolved RMAP_TYPE tab
--    caption: text, notes: text,
--    dwell_ms: int
--  }
--
--  Graceful: the client probes this table; absent (pre-migration) → no presentation UI, and
--  the Fázis-1 Lap-based ▶ tour keeps working. Idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

create table if not exists research_map_paths (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references research_projects(id) on delete cascade,
  name        text not null default 'Bemutató',
  ord         int not null default 0,
  steps       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists rmpath_project_idx on research_map_paths(project_id);

alter table research_map_paths enable row level security;

drop policy if exists rmpath_read on research_map_paths;
create policy rmpath_read on research_map_paths for select to authenticated
  using (research_can_read_project(project_id));

drop policy if exists rmpath_write on research_map_paths;
create policy rmpath_write on research_map_paths for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'research_map_paths') then
    alter publication supabase_realtime add table research_map_paths;
  end if;
end $$;
