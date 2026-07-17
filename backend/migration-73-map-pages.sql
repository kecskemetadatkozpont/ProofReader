-- ============================================================================
--  Publify — migration 73: Map pages (saved views)
--
--  A "page" is a named saved view of the research Map — a stored viewport (tx/ty/zoom)
--  plus an optional curation filter. The canonical use is "teljes gráf" (full graph) vs
--  "kurált nézet" (only the pinned/important cards). Pages do NOT partition the data; they
--  are lenses over the same graph. Switching a page restores its viewport and applies its
--  filter. The implicit default (no page selected) shows everything at the current view.
--
--  RLS mirrors research_map_layout: read = readers, write = editors. Realtime so the tab
--  bar stays in sync. Idempotent. Graceful: absent (pre-migration) → the page bar is off.
-- ============================================================================

create table if not exists research_map_pages (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references research_projects(id) on delete cascade,
  name         text not null default 'Nézet',
  tx           real not null default 30,
  ty           real not null default 18,
  k            real not null default 1,
  only_pinned  boolean not null default false,
  ord          int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists rmp_project_idx on research_map_pages(project_id);

alter table research_map_pages enable row level security;

drop policy if exists rmp_read on research_map_pages;
create policy rmp_read on research_map_pages for select to authenticated
  using (research_can_read_project(project_id));

drop policy if exists rmp_write on research_map_pages;
create policy rmp_write on research_map_pages for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'research_map_pages') then
    alter publication supabase_realtime add table research_map_pages;
  end if;
end $$;
