-- ============================================================================
--  Publify — migration 46: personal ToDo tasks (research_todos).
--
--  A per-user task list that powers the header-pinned personal Kanban and the
--  "Add Task" button on every board. Distinct from research_protocol_steps (which
--  are AI-generated, runner-executed): these are hand-added ToDos a person owns.
--  A todo may be linked to a research project (project_id) or be a standalone
--  personal task (project_id null). The board's human↔AI columns come from
--  (assignee, status), exactly like the protocol-step board, so both entities can
--  render side by side.
--
--  The autonomous runner NEVER touches research_todos — no cross-wiring with the
--  protocol pipeline, so a manual ToDo can't accidentally be executed.
--
--  RLS: owner + admin always; project-linked todos are also visible to anyone who
--  can read that project (so a supervisor sees them on the student's board). Writes
--  are owner-or-admin only. Apply in the Supabase SQL Editor. Idempotent.
-- ============================================================================

create table if not exists research_todos (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references profiles(id) on delete cascade,
  project_id  uuid references research_projects(id) on delete set null,   -- null = global personal task
  title       text not null,
  notes       text,
  assignee    text not null default 'human' check (assignee in ('ai', 'human')),
  status      text not null default 'todo'  check (status in ('todo', 'doing', 'blocked', 'done')),
  priority    text check (priority in ('low', 'med', 'high')),
  due         date,
  sort        int  not null default 0,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists rtd_owner_idx   on research_todos(owner_id);
create index if not exists rtd_project_idx on research_todos(project_id);
create index if not exists rtd_status_idx  on research_todos(owner_id, status);

alter table research_todos enable row level security;

-- READ: your own, or admin, or a todo attached to a project you can read (supervisor/collaborator).
drop policy if exists rtd_read on research_todos;
create policy rtd_read on research_todos for select to authenticated
  using (owner_id = auth.uid() or is_admin() or (project_id is not null and research_can_read_project(project_id)));

-- WRITE: owner or admin. INSERT must stamp yourself as owner (or be admin).
drop policy if exists rtd_insert on research_todos;
create policy rtd_insert on research_todos for insert to authenticated
  with check (owner_id = auth.uid() or is_admin());
drop policy if exists rtd_update on research_todos;
create policy rtd_update on research_todos for update to authenticated
  using (owner_id = auth.uid() or is_admin()) with check (owner_id = auth.uid() or is_admin());
drop policy if exists rtd_delete on research_todos;
create policy rtd_delete on research_todos for delete to authenticated
  using (owner_id = auth.uid() or is_admin());
