-- ============================================================================
--  Publify — migration 71: Map frames (named regions / "phase lanes")
--
--  A frame is a titled rectangle drawn BEHIND the cards on the research Map — used to
--  group cards visually (e.g. "Ötlet", "Irodalom", "Batch 1") the way Luma/FigJam frames
--  do. Frames live in world coordinates (pan/zoom with the canvas). They are pure
--  annotation: they do not own the cards inside them, they just visually enclose a region.
--
--  RLS mirrors research_map_layout (migration-63): read = project readers, write = editors.
--  Realtime so collaborators see frame edits live. Idempotent. Apply in the SQL editor.
--
--  Graceful: the client probes this table; if it is absent (pre-migration) the frames UI
--  simply does not appear and the Map is unchanged.
-- ============================================================================

create table if not exists research_map_frames (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references research_projects(id) on delete cascade,
  title       text not null default 'Keret',
  x           real not null default 0,
  y           real not null default 0,
  w           real not null default 420,
  h           real not null default 300,
  color       text not null default 'slate',
  created_by  uuid default auth.uid() references profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);
create index if not exists rmf_project_idx on research_map_frames(project_id);

alter table research_map_frames enable row level security;

drop policy if exists rmf_read on research_map_frames;
create policy rmf_read on research_map_frames for select to authenticated
  using (research_can_read_project(project_id));

drop policy if exists rmf_write on research_map_frames;
create policy rmf_write on research_map_frames for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'research_map_frames') then
    alter publication supabase_realtime add table research_map_frames;
  end if;
end $$;
