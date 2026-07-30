-- ============================================================================
--  Publify baseline — STEP 0: required Postgres extensions.
--  Run this FIRST on a fresh Supabase project, BEFORE 01_schema.sql.
--
--  The schema dump (01) references objects in the `extensions` schema (pgvector)
--  and uses gen_random_uuid()/ltree/net — those extensions must exist first.
--  On Supabase, `pgcrypto` is usually pre-installed; the rest are enabled here.
--  pg_cron / pg_net may require enabling from the Dashboard (Database → Extensions)
--  on some plans — if CREATE EXTENSION fails, enable them there and re-run.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;   -- gen_random_uuid()
create extension if not exists ltree;                             -- containment paths (project.protocol.step)
create extension if not exists vector with schema extensions;     -- pgvector (km_* embeddings / hybrid search)
create extension if not exists pg_net;                            -- async HTTP from SQL (edge/webhook helpers)
create extension if not exists pg_cron;                           -- scheduled jobs
