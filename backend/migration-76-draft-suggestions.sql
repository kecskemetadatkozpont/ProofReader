-- ============================================================================
--  Publify — migration 76: draft suggestions (cooperative Phase 3 — suggesting mode)
--
--  A lightweight Google-Docs-style "suggesting mode" for the generated draft. Instead of
--  overwriting a section, a collaborator proposes a rewrite; the owner/editor reviews it
--  (accept → applies to research_drafts.sections; reject → discard). Because a project
--  READER (e.g. a read-only supervisor) is exactly who wants to suggest edits, INSERT is
--  open to any project reader (author must be self); accept/reject/withdraw is limited to
--  the author or a project editor.
--
--  RLS:
--    read   — project readers
--    insert — project readers, author = auth.uid()
--    update — author OR project editor (resolve/withdraw)
--    delete — author OR project editor
--  Realtime enabled. Idempotent. Graceful: absent (pre-migration) → no suggesting UI.
-- ============================================================================

create table if not exists research_draft_suggestions (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references research_projects(id) on delete cascade,
  draft_id        uuid not null references research_drafts(id) on delete cascade,
  section_key     text,
  section_heading text,
  original        text,
  suggested       text not null,
  note            text,
  author          uuid not null default auth.uid() references profiles(id) on delete set null,
  status          text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references profiles(id) on delete set null
);
create index if not exists rds_draft_idx on research_draft_suggestions(draft_id);
create index if not exists rds_project_idx on research_draft_suggestions(project_id);

alter table research_draft_suggestions enable row level security;

drop policy if exists rds_read on research_draft_suggestions;
create policy rds_read on research_draft_suggestions for select to authenticated
  using (research_can_read_project(project_id));

drop policy if exists rds_insert on research_draft_suggestions;
create policy rds_insert on research_draft_suggestions for insert to authenticated
  with check (research_can_read_project(project_id) and author = auth.uid());

drop policy if exists rds_update on research_draft_suggestions;
create policy rds_update on research_draft_suggestions for update to authenticated
  using (author = auth.uid() or research_can_write_project(project_id))
  with check (author = auth.uid() or research_can_write_project(project_id));

drop policy if exists rds_delete on research_draft_suggestions;
create policy rds_delete on research_draft_suggestions for delete to authenticated
  using (author = auth.uid() or research_can_write_project(project_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'research_draft_suggestions') then
    alter publication supabase_realtime add table research_draft_suggestions;
  end if;
end $$;
