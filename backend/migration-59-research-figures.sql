-- ============================================================================
--  Publify — migration 59: Figure Board (figures extracted from Library PDFs)
--
--  Backs the "Figure Board": for a Library paper (research_sources) with an
--  open-access PDF, Publify extracts each figure (caption-anchored region crop),
--  stores the image in the research-data bucket, and records it here — laid out
--  on an infinite canvas grouped per paper.
--
--  Prereq: migration-14 (research_sources) + migration-11 helpers
--  (research_can_read_project / research_can_write_project). Idempotent.
-- ============================================================================

create table if not exists public.research_figures (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.research_projects(id) on delete cascade,
  source_id     uuid references public.research_sources(id) on delete cascade,   -- the Library paper it came from
  page          int,                          -- 1-based PDF page
  ord           int,                          -- figure order within the paper (0-based)
  fig_label     text,                         -- e.g. "Figure 3"
  caption       text,
  storage_path  text not null,                -- object key in the research-data bucket
  width         int,
  height        int,
  x             double precision,             -- board position (null → auto-layout)
  y             double precision,
  hidden        boolean not null default false,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (source_id, ord)
);
create index if not exists research_figures_project_idx on public.research_figures(project_id, created_at);

alter table public.research_figures enable row level security;
drop policy if exists rfig_read  on public.research_figures;
create policy rfig_read  on public.research_figures for select to authenticated
  using (public.research_can_read_project(project_id));
drop policy if exists rfig_write on public.research_figures;
create policy rfig_write on public.research_figures for all to authenticated
  using (public.research_can_write_project(project_id)) with check (public.research_can_write_project(project_id));
grant select, insert, update, delete on table public.research_figures to authenticated;

-- Figure images live under the existing research-data bucket at:  <project_id>/figures/<source_id>/<ord>.png
-- (project_id MUST be the FIRST path segment — the research-data bucket RLS in migration-15 scopes writes on foldername[1])
-- (that bucket's RLS already scopes objects to project members — no new bucket needed).

-- Verify after apply:  select count(*) from research_figures;   -- 0
