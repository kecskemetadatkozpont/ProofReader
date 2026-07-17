-- ============================================================================
--  Publify — migration 80: per-node card size (resizable Map cards)
--
--  Lets a Map card be resized by dragging its corner; the size persists per node so the
--  card content can reflow to it (CSS @container tiers), independent of zoom. Adds two
--  nullable columns to research_map_layout (migration-63): card_w / card_h. NULL = auto
--  (the card keeps today's fixed width + measured height). No RLS change — research_map_layout
--  already gates writes to project editors.
--
--  Graceful: the client probes these columns on load; if absent (pre-migration) the resize
--  grip is simply not rendered and every card auto-sizes exactly as today. Idempotent.
-- ============================================================================

alter table research_map_layout add column if not exists card_w real;
alter table research_map_layout add column if not exists card_h real;

comment on column research_map_layout.card_w is 'Manual card width on the Map (px, world units). NULL = auto (default 204).';
comment on column research_map_layout.card_h is 'Manual card height on the Map (px, world units). NULL = auto (measured).';
