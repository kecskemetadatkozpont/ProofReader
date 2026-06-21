-- migration-22 — Research Notes: a per-project block-based notes document (Notion-like), stored as jsonb.
-- License-clean, self-built. Blocks: [{id,type,text,checked}] where type = p|h1|h2|h3|bullet|todo|quote|code.

create table if not exists public.research_notes (
  project_id uuid primary key references public.research_projects(id) on delete cascade,
  blocks     jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.research_notes enable row level security;
drop policy if exists rn_read on public.research_notes;
create policy rn_read on public.research_notes for select using (public.research_can_read_project(project_id));
drop policy if exists rn_write on public.research_notes;
create policy rn_write on public.research_notes for all
  using (public.research_can_write_project(project_id)) with check (public.research_can_write_project(project_id));
