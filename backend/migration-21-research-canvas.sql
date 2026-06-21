-- migration-21 — Research Canvas: a per-project edgeless whiteboard (nodes + edges) stored as jsonb.
-- License-clean, self-built (no BlockSuite). One canvas per research project; RLS mirrors the project.

create table if not exists public.research_canvas (
  project_id uuid primary key references public.research_projects(id) on delete cascade,
  data       jsonb not null default '{"nodes":[],"edges":[],"view":{}}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.research_canvas enable row level security;

drop policy if exists rcv_read on public.research_canvas;
create policy rcv_read on public.research_canvas for select
  using (public.research_can_read_project(project_id));

drop policy if exists rcv_write on public.research_canvas;
create policy rcv_write on public.research_canvas for all
  using (public.research_can_write_project(project_id))
  with check (public.research_can_write_project(project_id));
