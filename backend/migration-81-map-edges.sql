-- ============================================================================
--  Publify — migration 81: interactive Map edges (research_map_edges)
--
--  Today the Map edges are DERIVED (in graph()) as [fromId, toId, kind?] and rendered as
--  silent provenance lines. This table makes them first-class: a per-edge row stores a
--  semantic relation TYPE + style OVERRIDE (color / animation / line-style / arrow / width /
--  label), keyed by a STABLE edge_key = fromId|toId|kind (survives re-derivation, node
--  hide/show, and curated-page filtering — never bound to the fragile array index).
--
--    - override row (manual=false): re-types/re-styles a DERIVED edge; deleting the row
--      restores the derived default ("↺ Alaphelyzet").
--    - manual row  (manual=true):   a user-drawn semantic edge (P2 link-mode) that graph()
--      also folds into E. (P0 writes only override rows.)
--
--  kind (semantic relation): erd=Származás · idz=Idézet · bem=Bemenete · tam=Támogatja ·
--                            ell=Ellentmond · fug=Függőség · kap=Kapcsolódik
--  anim: flow|comet|pulse|draw|pingpong|calm   line_style: solid|dashed|dotted|double
--  arrow: ''|ar|bl
--
--  Graceful: the client probes this table; absent (pre-migration) → edgesCap stays false and
--  the edges render EXACTLY as today (no hit-path, no inspector, no override). RLS + realtime
--  cloned verbatim from research_map_paths (migration-79). Idempotent. Apply in the SQL editor.
-- ============================================================================

create table if not exists research_map_edges (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references research_projects(id) on delete cascade,
  edge_key    text not null,
  from_id     text not null,
  to_id       text not null,
  kind        text,
  color       text,
  anim        text,
  line_style  text,
  arrow       text,
  width       real,
  label       text,
  manual      boolean not null default false,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, edge_key)
);
create index if not exists rmedge_project_idx on research_map_edges(project_id);

alter table research_map_edges enable row level security;

drop policy if exists rmedge_read on research_map_edges;
create policy rmedge_read on research_map_edges for select to authenticated
  using (research_can_read_project(project_id));

drop policy if exists rmedge_write on research_map_edges;
create policy rmedge_write on research_map_edges for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'research_map_edges') then
    alter publication supabase_realtime add table research_map_edges;
  end if;
end $$;
