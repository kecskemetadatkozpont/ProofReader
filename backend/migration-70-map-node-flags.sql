-- ============================================================================
--  Publify — migration 70: per-node Map flags (pin + hide)
--
--  Generalizes the Figure "show on the Map" idea (migration-69, research_figures.on_map)
--  to ANY Map node. research_map_layout already stores a per-node {x,y}; we add two
--  optional flags on the same row:
--    * hidden  — the node is removed from the Map only (restorable from the "hidden" panel);
--                does NOT delete the underlying entity.
--    * pinned  — the node is marked important (📌 badge + highlight ring); a curation aid.
--
--  Because x/y are NOT NULL, the client always upserts the node's current position
--  together with the flag (it has the rendered coords at click time). No RLS change:
--  research_map_layout already gates writes to project editors.
--
--  Graceful: the client probes these columns on load; if absent (pre-migration) the
--  pin/hide UI simply does not appear and the Map behaves exactly as before.
--  Idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

alter table research_map_layout add column if not exists hidden boolean not null default false;
alter table research_map_layout add column if not exists pinned boolean not null default false;

comment on column research_map_layout.hidden is
  'Hide this node on the Map only (restorable). Does not delete the entity. Default false.';
comment on column research_map_layout.pinned is
  'Mark this node important on the Map (pin badge + highlight). Default false.';
