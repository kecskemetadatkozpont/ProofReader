-- ============================================================================
--  Publify — migration 114: link a research GAP to the systematic review it came from.
--
--  The Autopilot develops several ideas IN PARALLEL, each with its own study
--  (systematic review). Gaps were generated once per PROJECT, so every thread
--  showed the same set and a gap could not be traced back to the review that
--  revealed it. research-ai's gap_analyze now accepts a study_id and records it
--  here, so each thread branches from its OWN review's gaps.
--
--  Nullable + ON DELETE SET NULL: legacy/project-wide gaps simply have no study.
--  The edge degrades gracefully when this migration is not applied yet.
--
--  Idempotent; run in the Supabase SQL editor.
-- ============================================================================

alter table public.research_ideas
  add column if not exists study_id uuid references public.research_studies(id) on delete set null;

comment on column public.research_ideas.study_id is
  'For source=''gap'': the systematic review (research_studies) whose screened-in literature revealed this gap. NULL = project-wide/legacy gap.';

create index if not exists research_ideas_study_idx on public.research_ideas(study_id) where study_id is not null;
