-- ============================================================================
--  Publify — migration 99: free-floating Map objects (Canvas → Map merge).
--
--  The separate "Canvas" (Vászon) whiteboard is being folded INTO the Map. Its
--  unique content — free NOTE cards + MEDIA/LINK cards (image / pdf / video /
--  youtube-vimeo / website link / markdown) — becomes first-class Map nodes so
--  the whole Map toolset (free-drag, pin/hide, edges, comments, export,
--  realtime, presence) applies to them too.
--
--  Row-per-object (NOT a single jsonb blob like research_canvas) so parallel
--  collaborators don't clobber each other — same lesson as migration-98.
--  Position/size live in research_map_layout (node_id = 'o'+id), like every
--  other Map node. Mirrors research_map_frames' RLS exactly.
--
--  Idempotent; run in the SQL editor. Requires migration-71 (research_can_write_project).
-- ============================================================================

create table if not exists public.research_map_objects (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.research_projects(id) on delete cascade,
  kind          text not null default 'note',   -- note | image | pdf | video | link | markdown
  text          text,                            -- note / markdown body
  url           text,                            -- link / external URL
  storage_path  text,                            -- uploaded media in the research-data bucket
  meta          jsonb not null default '{}'::jsonb,  -- {name, mime, ...}
  created_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists rmo_project_idx on public.research_map_objects(project_id);

alter table public.research_map_objects enable row level security;

drop policy if exists rmo_read on public.research_map_objects;
create policy rmo_read on public.research_map_objects for select to authenticated
  using (research_can_read_project(project_id));

drop policy if exists rmo_write on public.research_map_objects;
create policy rmo_write on public.research_map_objects for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));

grant select, insert, update, delete on public.research_map_objects to authenticated;
