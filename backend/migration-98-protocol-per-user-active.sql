-- ============================================================================
--  Publify — migration 98: allow PARALLEL protocol work by multiple collaborators.
--
--  BUG: when several users generated protocols on the Map in parallel, only the
--  newest protocol's cards survived — the older ones vanished. Two causes:
--   (1) the unique index rprot_one_active enforced at most ONE active (non-
--       terminal) protocol PER PROJECT, so the generate edge fn archived EVERY
--       active protocol in the project before inserting the new one — wiping
--       other users' protocols; and
--   (2) the Map loaded only the single newest protocol (limit 1).
--
--  FIX (this migration = the DB half): change the "one active" rule from
--  per-PROJECT to per-(project, created_by) — i.e. each collaborator may keep
--  their OWN active protocol, and they coexist. The generate edge fn is updated
--  to archive only the CALLER's own previous active protocol; the Map is updated
--  to render every non-archived protocol as its own step-chain.
--
--  created_by is NULL on some legacy rows; NULLs are distinct in a unique index,
--  so those never block anything (matches prior behaviour for un-owned rows).
--
--  Idempotent; run in the SQL editor. Requires migration-35.
-- ============================================================================

drop index if exists rprot_one_active;

create unique index if not exists rprot_one_active_per_user
  on public.research_protocols (project_id, created_by)
  where status not in ('archived', 'done');
