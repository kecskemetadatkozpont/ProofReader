-- ============================================================================
--  Publify — migration 13: Research R2 (supervisor daily digest).
--  Each day, summarise every supervisor's students' previous-day research_log
--  activity into one notification (kind='digest'). Pure SQL + pg_cron — no external
--  key. Idempotent per (supervisor, day). Run in the SQL editor.
--  Builds on migration-07/08 (phd_students/supervisions), migration-11 (research_*).
-- ============================================================================

-- Build digests for `for_day` (one notification per supervisor who had student activity that day).
-- Returns the number of digests created. Idempotent: skips a supervisor already digested for the day.
create or replace function public.build_research_digests(for_day date) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  insert into notifications (recipient_id, kind, payload)
  select sup.supervisor_id, 'digest',
         jsonb_build_object(
           'day', for_day,
           'entries', count(*),
           'students', count(distinct st.id),
           'projects', count(distinct rp.id),
           'student_names', jsonb_agg(distinct st.name),
           'items', jsonb_agg(jsonb_build_object(
                'student', st.name, 'project', rp.title, 'type', rl.type,
                'summary', rl.summary, 'ts', rl.ts) order by rl.ts)
         )
  from (
    select v.supervisor_id, v.student_id from phd_supervisions v where v.status = 'accepted'
    union
    select s.supervisor_id, s.id from phd_students s where s.supervisor_id is not null
  ) sup
  join phd_students st on st.id = sup.student_id
  join research_projects rp on rp.student_id = st.id
  join research_log rl on rl.project_id = rp.id
  where rl.ts >= for_day::timestamptz
    and rl.ts < (for_day + 1)::timestamptz
    and not exists (
      select 1 from notifications nx
      where nx.recipient_id = sup.supervisor_id and nx.kind = 'digest'
        and (nx.payload->>'day') = for_day::text
    )
  group by sup.supervisor_id;
  get diagnostics n = row_count;
  return n;
end; $$;

-- Convenience wrapper: digest yesterday (what the cron calls).
create or replace function public.run_research_digests_yesterday() returns int
language sql security definer set search_path = public as $$
  select public.build_research_digests((now() - interval '1 day')::date);
$$;

-- ---- pg_cron schedule (optional) -------------------------------------------
-- Enable pg_cron once in: Dashboard → Database → Extensions → pg_cron, then run:
--   select cron.schedule('research-daily-digest', '0 5 * * *',
--                        $$ select public.run_research_digests_yesterday(); $$);
-- (05:00 UTC daily.) Until then digests can be built on demand via the RPC above.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('research-daily-digest') where exists (select 1 from cron.job where jobname = 'research-daily-digest');
    perform cron.schedule('research-daily-digest', '0 5 * * *', $$ select public.run_research_digests_yesterday(); $$);
  end if;
end $$;
