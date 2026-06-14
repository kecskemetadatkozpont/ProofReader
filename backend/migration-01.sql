-- ============================================================================
--  ProofReader — migration 01:  project data column (blob model)
--  Run this once in the Supabase SQL Editor (it's safe to re-run).
--
--  ProofReader stores each project as one nested object (files, members,
--  versions, comments, activity). To keep the working app's data model intact
--  while making it durable & shared, we persist that whole object in a single
--  jsonb column on `projects`. The relational columns (owner_id, title,
--  deleted_at) still drive listing and Row-Level Security.
-- ============================================================================

alter table projects add column if not exists data jsonb;

-- Make sure Realtime streams project changes to collaborators.
-- (Database → Replication also exposes a UI for this; this line is idempotent.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table projects;
  end if;
end $$;
