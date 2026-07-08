-- ============================================================================
--  Publify — migration 47: fold the legacy research_tasks into research_todos.
--
--  P0 "unify the task model": the Tasks subtab now reads/writes research_todos
--  (migration-46) like the board and "My tasks", so there is ONE human-task table
--  (+ research_protocol_steps for AI execution). This migration copies any existing
--  research_tasks rows into research_todos so nothing is stranded, mapping the
--  simpler todo/doing/done status onto the todos vocab and owning each row to the
--  project owner. Idempotent (deduped on project_id+title+owner). research_tasks is
--  left in place (read nowhere now) — drop it once you've confirmed the copy.
--
--  Apply in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

insert into research_todos (owner_id, created_by, project_id, title, notes, assignee, status, due, sort, created_at, updated_at)
select rp.owner_id, rp.owner_id, t.project_id, t.title, null, 'human',
       case when t.status = 'doing' then 'doing' when t.status = 'done' then 'done' else 'todo' end,
       t.due, coalesce(t.sort, 0), coalesce(t.created_at, now()), now()
from research_tasks t
join research_projects rp on rp.id = t.project_id
where not exists (
  select 1 from research_todos d
  where d.project_id = t.project_id and d.title = t.title and d.owner_id = rp.owner_id
);

-- Optional, after verifying the copy in the app:
--   drop table if exists research_tasks cascade;
