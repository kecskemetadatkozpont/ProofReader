-- ============================================================================
--  Publify — migration 102: Integrity Reviewer findings (Claude Science borrow).
--
--  An active provenance guard: the research-integrity edge fn compares the
--  manuscript's claims/numbers against the project's real artifacts (research_files
--  content, research_log RESULT entries, research_sources) and records what doesn't
--  trace — untraceable numbers, figure↔data mismatches, statistical red flags,
--  citation validity, cross-artifact inconsistencies. Advises; never auto-edits.
--
--  RLS: project members read + write their project's findings (ack/dismiss);
--  the edge fn inserts under the caller's JWT.
--
--  Idempotent; run in the SQL editor. Requires migration-11 (research_can_read/write_project).
-- ============================================================================

create table if not exists public.research_integrity_findings (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.research_projects(id) on delete cascade,
  kind        text not null,   -- untraceable_number | figure_data | citation | stat_flag | cross_inconsistency
  severity    text not null default 'medium',   -- high | medium | low
  claim       text not null,   -- the flagged claim / number, verbatim-ish
  location    text,            -- where in the manuscript (section / paragraph)
  evidence    text,            -- what it was checked against (artifact + values)
  suggestion  text,
  ref_number  text,            -- the extracted number, if this is a number finding (for badge/highlight matching)
  status      text not null default 'open',   -- open | acknowledged | dismissed
  run_id      uuid,            -- the analysis run that produced it (so a re-run can supersede open ones)
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists rif_project_idx on public.research_integrity_findings (project_id, status);

alter table public.research_integrity_findings enable row level security;

drop policy if exists rif_read on public.research_integrity_findings;
create policy rif_read on public.research_integrity_findings for select to authenticated
  using (research_can_read_project(project_id));

drop policy if exists rif_write on public.research_integrity_findings;
create policy rif_write on public.research_integrity_findings for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));

grant select, insert, update, delete on public.research_integrity_findings to authenticated;
