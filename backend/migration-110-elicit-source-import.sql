-- migration-110-elicit-source-import.sql
-- Elicit systematic-review papers → the project's reference Library (research_sources / "Irodalom").
-- When an Elicit sysreview job completes, elicit-proxy auto-imports EVERY found paper into research_sources
-- (source_api='elicit'), so the Irodalom database shows Elicit-derived literature next to OpenAlex results.
--
-- This adds a provenance link: which elicit_jobs run a source row came from (for the "🧪 Elicit" badge and
-- so a re-import / job delete can be reasoned about). Merge is by (project_id, ext_id) where ext_id='doi:'+doi,
-- so an OpenAlex row and an Elicit row for the SAME DOI collapse into ONE row (origin_job_id then tags it).
--
-- Prereq: migration-14 (research_sources), 51 (elicit_jobs). Apply MANUALLY in the Supabase SQL editor. Idempotent.
alter table public.research_sources
  add column if not exists origin_job_id uuid references public.elicit_jobs(id) on delete set null;

create index if not exists research_sources_origin_job_idx
  on public.research_sources(origin_job_id) where origin_job_id is not null;

-- verify:
--   select column_name from information_schema.columns
--    where table_name='research_sources' and column_name='origin_job_id';
--   select count(*) from public.research_sources where origin_job_id is not null;
