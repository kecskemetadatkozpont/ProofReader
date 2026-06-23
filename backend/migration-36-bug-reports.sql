-- #13 — in-app bug report system. Users submit reports; they see their own, admins see all.
create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  title text,
  body text not null,
  page text,
  app_version text,
  status text not null default 'open',   -- open | triaged | fixed | wontfix
  created_at timestamptz not null default now()
);

alter table public.bug_reports enable row level security;

drop policy if exists br_insert on public.bug_reports;
create policy br_insert on public.bug_reports for insert
  with check (reporter_id = auth.uid());

drop policy if exists br_read on public.bug_reports;
create policy br_read on public.bug_reports for select
  using (reporter_id = auth.uid() or public.is_admin());

drop policy if exists br_update on public.bug_reports;
create policy br_update on public.bug_reports for update
  using (public.is_admin()) with check (public.is_admin());

create index if not exists br_reporter_idx on public.bug_reports(reporter_id);
create index if not exists br_status_idx on public.bug_reports(status);
