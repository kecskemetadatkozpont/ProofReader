-- migration-20 — daily auto-generation of student reports (optional layer on top of on-demand).
-- A pg_cron job calls the student-digest Edge function in BATCH mode (service role) once a day for
-- "yesterday", so every supervised student with activity gets a fresh report + a bell notification.
--
-- Prerequisites (Dashboard → Database → Extensions): enable pg_cron AND pg_net.
-- The service-role key is read from Vault (never hard-code it here). Store it once:
--    select vault.create_secret('<YOUR_SERVICE_ROLE_KEY>', 'student_digest_service_key');
--
-- Then schedule (05:30 UTC daily). cron.schedule by name is idempotent (re-running replaces the job):

select cron.schedule(
  'student-daily-digest',
  '30 5 * * *',
  $job$
  select net.http_post(
    url     := 'https://jokqthwszkweyqmmdesn.supabase.co/functions/v1/student-digest',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'student_digest_service_key')),
    body    := jsonb_build_object('batch', true, 'day', (now() - interval '1 day')::date::text)
  );
  $job$
);

-- To remove:  select cron.unschedule('student-daily-digest');
