-- migration-23: research_files — per-project file tree for the session file browser.
-- Holds Markdown files the Claude session writes, plus manual uploads. Text files keep their content
-- inline (like research_notes); binary uploads keep a storage_path into the research-data bucket.
create table if not exists public.research_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects(id) on delete cascade,
  path text not null,                       -- relative path, e.g. 'lit-review.md' or 'notes/plan.md'
  content text,                             -- inline text (md/txt/csv…); null for binary
  storage_path text,                        -- research-data bucket path for binary; null for inline text
  mime text default 'text/markdown',
  size int default 0,
  source text default 'manual',             -- 'ai' | 'upload' | 'manual'
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  updated_by uuid,
  unique (project_id, path)
);
alter table public.research_files enable row level security;
drop policy if exists rf_read on public.research_files;
create policy rf_read on public.research_files for select to authenticated
  using (public.research_can_read_project(project_id));
drop policy if exists rf_write on public.research_files;
create policy rf_write on public.research_files for all to authenticated
  using (public.research_can_write_project(project_id)) with check (public.research_can_write_project(project_id));
create index if not exists rf_project_idx on public.research_files(project_id);
