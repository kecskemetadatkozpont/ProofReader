-- ============================================================================
--  Publify — migration 43: Protocol review notes (iteration surface).
--  Per-step concerns / observations / new directions raised while reviewing a
--  protocol's results. ANY project member may post a note (read-access = member);
--  turning a "new direction" into a runnable follow-up task stays an editor action
--  (that inserts a research_protocol_steps row, which is write-gated already).
--  A note is a lightweight comment — it never overwrites the runner's step.result.
-- ============================================================================
create table if not exists research_protocol_notes (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references research_projects(id) on delete cascade,
  protocol_id  uuid not null references research_protocols(id) on delete cascade,
  step_id      uuid references research_protocol_steps(id) on delete cascade,
  author_id    uuid references profiles(id) on delete set null,
  author_name  text,                                   -- denormalized for display (no join needed)
  kind         text not null default 'concern' check (kind in ('concern','obs','dir')),
  body         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists rpn_step_idx    on research_protocol_notes(step_id);
create index if not exists rpn_project_idx  on research_protocol_notes(project_id);
create index if not exists rpn_protocol_idx on research_protocol_notes(protocol_id);

alter table research_protocol_notes enable row level security;

-- read: any member of the project
drop policy if exists rpn_read on research_protocol_notes;
create policy rpn_read on research_protocol_notes for select to authenticated
  using (research_can_read_project(project_id));

-- insert: any member, posting as themselves
drop policy if exists rpn_insert on research_protocol_notes;
create policy rpn_insert on research_protocol_notes for insert to authenticated
  with check (research_can_read_project(project_id) and author_id = auth.uid());

-- delete: the author only (project editors could be added later if needed)
drop policy if exists rpn_delete on research_protocol_notes;
create policy rpn_delete on research_protocol_notes for delete to authenticated
  using (author_id = auth.uid());
