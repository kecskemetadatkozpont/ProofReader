-- Publify — migration 111: deterministic, cached Evidence-Gap Matrix.
--
-- PROBLEM: the Research Gap Matrix (action='gap_matrix' in research-ai) was recomputed by an LLM on EVERY load
--          with the Anthropic default temperature (=1.0) and freely-derived axes, so users saw DIFFERENT gaps
--          each time. Fix = (a) temperature 0 + stable input order + a prompt version (in the edge fn), and
--          (b) PERSIST the computed matrix here, keyed by project, with a fingerprint of the inputs it depends on.
--          On load the edge returns the cached matrix while the fingerprint matches (no LLM call, identical result);
--          it only recomputes when the inputs change (sources added / screening changed / model / prompt version)
--          or the user explicitly forces a recompute.
--
-- Fingerprint = sha256( promptVersion | model | project.title | project.goal | keywords | sorted(source_id:screening) ).
--
-- Apply MANUALLY in the Supabase SQL editor (this project keeps backend/*.sql applied by hand — no supabase/migrations).

create table if not exists public.research_gap_matrix (
  project_id   uuid primary key references public.research_projects(id) on delete cascade,
  matrix       jsonb       not null,          -- {rows, cols, cells, cellSources}
  fingerprint  text        not null,          -- sha256 hex of the inputs the matrix depends on
  model        text,
  source_count int,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.research_gap_matrix enable row level security;

-- read: anyone who can read the project (owner / member / supervisor / admin) — same helper every research_* child uses
drop policy if exists rgm_read on public.research_gap_matrix;
create policy rgm_read on public.research_gap_matrix for select to authenticated
  using (public.research_can_read_project(project_id));

-- write: project editors/owner/admin (viewers read the cache an editor populated; they never persist)
drop policy if exists rgm_write on public.research_gap_matrix;
create policy rgm_write on public.research_gap_matrix for all to authenticated
  using (public.research_can_write_project(project_id))
  with check (public.research_can_write_project(project_id));

grant select, insert, update, delete on public.research_gap_matrix to authenticated;
