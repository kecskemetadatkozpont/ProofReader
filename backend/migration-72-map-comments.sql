-- ============================================================================
--  Publify — migration 72: Map comments / annotations
--
--  Comments pinned to the research Map — either to a specific card (node_id) or to a free
--  position on the canvas (x,y in world coords). Built for supervisor feedback: a reviewer
--  who is READ-ONLY on the project can still leave comments, so INSERT is allowed for any
--  project READER (not just editors). Editing/deleting a comment is limited to its author
--  or a project editor; resolving likewise.
--
--  RLS:
--    read   — project readers (research_can_read_project)
--    insert — project readers, but author must be the caller (with check author = auth.uid())
--    update/delete — author OR project editor
--
--  Realtime so threads update live. Idempotent. Apply in the Supabase SQL editor.
--  Graceful: the client probes this table; absent (pre-migration) → the comments UI is off.
-- ============================================================================

create table if not exists research_map_comments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references research_projects(id) on delete cascade,
  node_id     text,                 -- pinned to a card (materializer node id), or null for a free position
  x           real,                 -- world x (used when node_id is null)
  y           real,                 -- world y
  body        text not null,
  author      uuid not null default auth.uid() references profiles(id) on delete set null,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists rmc_project_idx on research_map_comments(project_id);

alter table research_map_comments enable row level security;

drop policy if exists rmc_read on research_map_comments;
create policy rmc_read on research_map_comments for select to authenticated
  using (research_can_read_project(project_id));

-- insert: any project reader may comment (supervisors are read-only but CAN annotate); author must be self
drop policy if exists rmc_insert on research_map_comments;
create policy rmc_insert on research_map_comments for insert to authenticated
  with check (research_can_read_project(project_id) and author = auth.uid());

-- update: the author or a project editor (used for resolve + edit)
drop policy if exists rmc_update on research_map_comments;
create policy rmc_update on research_map_comments for update to authenticated
  using (author = auth.uid() or research_can_write_project(project_id))
  with check (author = auth.uid() or research_can_write_project(project_id));

-- delete: the author or a project editor
drop policy if exists rmc_delete on research_map_comments;
create policy rmc_delete on research_map_comments for delete to authenticated
  using (author = auth.uid() or research_can_write_project(project_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'research_map_comments') then
    alter publication supabase_realtime add table research_map_comments;
  end if;
end $$;
