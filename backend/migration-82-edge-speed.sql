-- ============================================================================
--  Publify — migration 82: per-edge animation SPEED (research_map_edges.speed)
--
--  Adds an optional per-edge animation duration (seconds) to the interactive-edge
--  overrides table (migration-81). NULL = the animation's type default. The edge
--  inspector shows a speed slider only once this column exists.
--
--  Graceful: the client probes with a 2-tier select (with speed → without speed).
--  Pre-migration-82 the speed slider is simply hidden and every edge animates at
--  its type-default tempo; nothing else changes. Idempotent. Apply in the SQL editor.
-- ============================================================================

alter table research_map_edges add column if not exists speed real;
