-- ============================================================================
--  Publify — migration 44: task-board assignee.
--  Adds `assignee` to research_protocol_steps so the protocol Task board can
--  split work into human ↔ AI columns. All existing steps are runner (AI) work,
--  so the default is 'ai' and the column is back-filled to 'ai'. The runner keeps
--  executing steps as before (it ignores assignee); a 'human' step is a tracked
--  task a person owns and the runner does not touch.
--  Additive + idempotent; safe to re-run.
-- ============================================================================
alter table research_protocol_steps
  add column if not exists assignee text not null default 'ai';

-- constrain to the two roles the board uses (drop first so re-runs don't error)
alter table research_protocol_steps drop constraint if exists rpst_assignee_chk;
alter table research_protocol_steps
  add constraint rpst_assignee_chk check (assignee in ('ai', 'human'));

-- existing rows created before this column keep the default; make it explicit
update research_protocol_steps set assignee = 'ai' where assignee is null;

-- RLS is unchanged: writing assignee is part of a step update, already governed by
-- the existing rpst_write policy (editors of the project, via research_can_write_project).
