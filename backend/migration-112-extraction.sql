-- Publify — migration 112: question-based data extraction ("Kivonatolás", Elicit-style).
--
-- Turn a screened OpenAlex literature set into an EVIDENCE MATRIX: the user asks questions (columns), and the
-- system answers each per-paper from the full text (OA PDF → Claude document block) and/or the figures, with a
-- VERBATIM quote + location. Two tables: the questions (columns) and the answer cells (question × source).
--
-- Cells carry project_id (denormalised) so RLS reuses research_can_read/write_project directly — same helper every
-- research_* child uses. A cell is unique per (question_id, source_id). A fingerprint (question|source|model|
-- source_mode) enables an incremental cache: only NEW / changed cells re-run.
--
-- Apply MANUALLY in the Supabase SQL editor (this project keeps backend/*.sql applied by hand — no supabase/migrations).

-- ── questions (columns) ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.research_extraction_questions (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.research_projects(id) on delete cascade,
  study_id     uuid references public.research_studies(id) on delete set null,   -- optional: which funnel set
  text         text not null,
  answer_type  text not null default 'text',      -- text | number | bool | enum | list
  source_mode  text not null default 'fulltext',  -- fulltext | figures | both
  ord          int  not null default 0,           -- column order
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists reqq_project_idx on public.research_extraction_questions(project_id, ord);

-- ── cells (question × source) ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.research_extraction_cells (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.research_extraction_questions(id) on delete cascade,
  source_id    uuid not null references public.research_sources(id) on delete cascade,
  project_id   uuid not null references public.research_projects(id) on delete cascade,  -- denormalised for RLS
  answer       text,
  quote        text,                               -- verbatim supporting quote
  location     jsonb,                              -- { page, section, figure, basis:'pdf'|'abstract'|'figure' }
  confidence   text default 'na',                  -- high | mid | na
  status       text not null default 'pending',    -- pending | done | na | error
  error        text,
  model        text,
  fingerprint  text,                               -- sha256(question|source|model|source_mode) → incremental cache
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (question_id, source_id)
);
create index if not exists reqc_question_idx on public.research_extraction_cells(question_id);
create index if not exists reqc_project_idx  on public.research_extraction_cells(project_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.research_extraction_questions enable row level security;
alter table public.research_extraction_cells     enable row level security;

drop policy if exists reqq_read on public.research_extraction_questions;
create policy reqq_read on public.research_extraction_questions for select to authenticated
  using (public.research_can_read_project(project_id));
drop policy if exists reqq_write on public.research_extraction_questions;
create policy reqq_write on public.research_extraction_questions for all to authenticated
  using (public.research_can_write_project(project_id))
  with check (public.research_can_write_project(project_id));

drop policy if exists reqc_read on public.research_extraction_cells;
create policy reqc_read on public.research_extraction_cells for select to authenticated
  using (public.research_can_read_project(project_id));
drop policy if exists reqc_write on public.research_extraction_cells;
create policy reqc_write on public.research_extraction_cells for all to authenticated
  using (public.research_can_write_project(project_id))
  with check (public.research_can_write_project(project_id));

grant select, insert, update, delete on public.research_extraction_questions to authenticated;
grant select, insert, update, delete on public.research_extraction_cells     to authenticated;
