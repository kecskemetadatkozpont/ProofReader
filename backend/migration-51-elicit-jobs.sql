-- ============================================================================
--  Publify — migration 51: Elicit async jobs (Phase 2 — automated reports)
--
--  Prereq: migration-49 (is_admin) + migration-50 (elicit feature keys + budget).
--  Backs the elicit-proxy edge function: each Elicit report (later: systematic
--  review) is a per-user job row polled create → status → resume.
--
--  Apply in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

create table if not exists public.elicit_jobs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id        uuid,                                  -- optional link to a research_project
  kind              text not null default 'report',       -- 'report' | 'sysreview' (future)
  elicit_id         text,                                  -- Elicit's reportId / reviewId
  research_question text,
  q_hash            text,                                  -- for the pending-job idempotency guard
  status            text not null default 'processing',    -- processing|pausedForInsufficientQuota|completed|failed|unknown
  stage             text,                                  -- Elicit executionStage
  url               text,                                  -- Elicit web view
  is_public         boolean not null default false,
  request           jsonb,                                 -- {maxSearchPapers,maxExtractPapers,title}
  result_title      text,
  result_summary    text,
  result_body       text,                                  -- full markdown (when completed)
  result_abstract   text,
  pdf_url           text,
  docx_url          text,
  error             jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists elicit_jobs_user_idx   on public.elicit_jobs(user_id, kind, created_at desc);
create index if not exists elicit_jobs_active_idx  on public.elicit_jobs(status)
  where status in ('processing','pausedForInsufficientQuota','unknown');
-- idempotency: at most ONE non-terminal report per (user, question) → a double-click / retry can't
-- spawn duplicate 5–15 min (and quota-costing) jobs.
create unique index if not exists elicit_jobs_pending_uniq on public.elicit_jobs(user_id, kind, q_hash)
  where status not in ('completed','failed');

alter table public.elicit_jobs enable row level security;
drop policy if exists elicit_jobs_own on public.elicit_jobs;
create policy elicit_jobs_own on public.elicit_jobs for all to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
grant select, insert, update, delete on table public.elicit_jobs to authenticated;

-- ---------------------------------------------------------------------------
-- Secrets the elicit-proxy edge function reads:
--   ELICIT_API_KEY        elk_live_...  (required; Pro plan+)
--   ELICIT_REPORTS_DAILY  per-user daily report cap (default 3)
--   ELICIT_CRON_SECRET    shared secret for the optional server poller (below)
--
-- OPTIONAL server poller — completes reports even with no tab open, and is the
-- ONLY completion trigger (Elicit has no webhooks). Requires pg_cron + pg_net
-- (Dashboard → Database → Extensions) and the cron secret stored in Vault with
-- the SAME value as the function's ELICIT_CRON_SECRET:
--   select vault.create_secret('<ELICIT_CRON_SECRET value>', 'elicit_cron_secret');
-- Then schedule (every 2 min; cron.schedule by name is idempotent):
--   select cron.schedule('elicit-report-poll', '*/2 * * * *', $job$
--     select net.http_post(
--       url     := 'https://jokqthwszkweyqmmdesn.supabase.co/functions/v1/elicit-proxy',
--       headers := jsonb_build_object('Content-Type','application/json',
--                    'x-elicit-secret', (select decrypted_secret from vault.decrypted_secrets where name='elicit_cron_secret')),
--       body    := jsonb_build_object('action','cron_sweep')
--     );
--   $job$);
-- To remove:  select cron.unschedule('elicit-report-poll');
-- The sweep only REFRESHES status; it never blind-resumes a paused job (that would
-- 402-loop while the org is over quota — resume is a deliberate user/admin action).
-- ---------------------------------------------------------------------------
