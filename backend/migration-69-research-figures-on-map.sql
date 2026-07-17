-- migration-69: per-figure "show on the Map" flag, so the user can curate which extracted figures appear on the
-- research Map (PipelineCanvas) without hiding them everywhere (that is the separate `hidden` flag used by the
-- Figure Board). on_map=false → the figure is removed from the Map only; it can be restored from the Map's
-- "hidden figures" panel. Default true → existing figures keep showing on the Map.
--
-- No RLS change: research_figures already allows project members to UPDATE their rows.

alter table research_figures add column if not exists on_map boolean not null default true;

comment on column research_figures.on_map is
  'Show this figure on the research Map (PipelineCanvas). false = removed from the Map only (not the Figure Board). Default true.';
