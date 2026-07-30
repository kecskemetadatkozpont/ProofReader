-- migration-103-protocol-realtime.sql
-- Protocol cockpit (A) — live collaboration. Add the protocol tables to the `supabase_realtime` publication so a
-- collaborator's task INSERT/UPDATE/DELETE streams to everyone's board live (the client subscribes via postgres_changes,
-- filtered by protocol_id). Idempotent — safe to re-run. RLS still governs what each subscriber actually receives.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'research_protocol_steps') then
    alter publication supabase_realtime add table public.research_protocol_steps;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'research_protocols') then
    alter publication supabase_realtime add table public.research_protocols;
  end if;
end $$;

-- verify:
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'research_protocol%';  -- expect 2 rows
