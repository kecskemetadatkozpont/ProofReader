-- ============================================================================
--  Publify — migration 56: Elicit background poller + persisted freshness
--
--  Elicit has NO webhooks, so a job's completion is only observed by polling.
--  Until now the ONLY poller was the browser (20s, while the Studies tab is open).
--  This migration turns on a SERVER-SIDE poller (pg_cron → elicit-proxy/cron_sweep)
--  so reviews/reports finish, get imported, AND notify their owner even with no tab
--  open. It also persists `data_freshness` so the "updated Xm ago" hint survives a
--  reload / first paint (previously it was a transient poll-only field).
--
--  Prereq: migration-49..55 (elicit_jobs, notifications, is_admin).
--  Apply in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

-- 1) Persist the export-freshness timestamp (srPatch writes it; sr.list returns it).
alter table public.elicit_jobs add column if not exists data_freshness timestamptz;

-- ---------------------------------------------------------------------------
-- 2) Server-side poller (OPTIONAL but recommended). Requires the pg_cron + pg_net
--    extensions and a shared secret that MATCHES the edge function's
--    ELICIT_CRON_SECRET. The sweep only REFRESHES status (never blind-resumes a
--    paused job — that would 402-loop while the org is over quota).
--
--    Run the whole block below ONCE in the SQL editor. Replace the placeholder
--    <PASTE_ELICIT_CRON_SECRET> with the exact value set on the edge function
--    (secrets → ELICIT_CRON_SECRET). Same pattern you already use for KM_CRON_SECRET.
-- ---------------------------------------------------------------------------

-- 2a) extensions (Dashboard → Database → Extensions also works)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2b) store the secret in Vault (so it is not inlined in the cron job definition)
--     If it already exists, update it instead of creating a duplicate.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'elicit_cron_secret') then
    perform vault.create_secret('<PASTE_ELICIT_CRON_SECRET>', 'elicit_cron_secret');
  else
    perform vault.update_secret(
      (select id from vault.secrets where name = 'elicit_cron_secret'),
      '<PASTE_ELICIT_CRON_SECRET>');
  end if;
end $$;

-- 2c) schedule the sweep every 2 minutes (cron.schedule by name is idempotent)
select cron.schedule('elicit-job-poll', '*/2 * * * *', $job$
  select net.http_post(
    url     := 'https://jokqthwszkweyqmmdesn.supabase.co/functions/v1/elicit-proxy',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'x-elicit-secret', (select decrypted_secret from vault.decrypted_secrets where name='elicit_cron_secret')),
    body    := jsonb_build_object('action','cron_sweep')
  );
$job$);

-- To pause the poller:   select cron.unschedule('elicit-job-poll');
-- To inspect runs:       select * from cron.job_run_details where jobid =
--                          (select jobid from cron.job where jobname='elicit-job-poll')
--                          order by start_time desc limit 10;

-- Verify after apply:
--   select column_name from information_schema.columns
--     where table_name='elicit_jobs' and column_name='data_freshness';   -- 1 row
--   select jobname, schedule from cron.job where jobname='elicit-job-poll';  -- 1 row
