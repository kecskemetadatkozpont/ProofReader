-- migration-108-study-run-lock.sql
-- A run-lock on research_studies so a study that is being run/re-run is visible to ALL collaborators and its
-- modify/re-run controls are blocked for everyone else (prevents two users running the same study at once).
--   running_by  = the user currently running the study (NULL = free)
--   running_at  = heartbeat timestamp; a lock older than the client's freshness window (~12 min) is treated as
--                 stale (a crashed run) and ignored, so a dead client can never wedge a study permanently.
-- The client (whoever runs it) sets these via a normal UPDATE — allowed by the existing rst_write policy
-- (research_can_write_project). No new RPC needed. research_studies is added to the realtime publication so the
-- lock appears/clears live on every collaborator's Study surface.
-- Apply in the Supabase SQL editor. Idempotent — safe to re-run.
alter table public.research_studies add column if not exists running_by uuid references public.profiles(id) on delete set null;
alter table public.research_studies add column if not exists running_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'research_studies') then
    alter publication supabase_realtime add table public.research_studies;
  end if;
end $$;

-- verify:
--   select column_name from information_schema.columns where table_name='research_studies' and column_name in ('running_by','running_at');  -- 2 rows
--   select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='research_studies';  -- 1 row
