-- ============================================================================
--  Publify — migration 52: Elicit systematic reviews (Phase 3)
--
--  Prereq: migration-51 (elicit_jobs). Systematic reviews reuse elicit_jobs with
--  kind='sysreview'; these two columns hold the staged PRISMA data + the export
--  URLs that reports don't have.
--
--  Apply in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

alter table public.elicit_jobs add column if not exists stages  jsonb;   -- Elicit ReviewData: {search,screen,fulltext,extract:{csv,xlsx}}
alter table public.elicit_jobs add column if not exists exports jsonb;   -- report export URLs {pdf,docx,txt,bib,ris}

comment on column public.elicit_jobs.stages  is 'Elicit SR ReviewData — per-stage csv/xlsx download URLs (search/screen/fulltext/extract).';
comment on column public.elicit_jobs.exports is 'Elicit report/SR export URLs: {pdf,docx,txt,bib,ris}.';

-- Secrets the elicit-proxy edge function reads for SR (optional caps):
--   ELICIT_SYSREVIEW_DAILY   per-user daily systematic-review cap (default 1)
-- The existing cron_sweep (migration-51) already refreshes kind='sysreview' jobs.
