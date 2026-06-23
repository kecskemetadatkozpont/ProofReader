-- #13 — in-app bug / feature-request reports with a screenshot and an admin reply loop.
-- Idempotent: safe to run whether or not an earlier version of this table already exists.
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

-- columns added by the extension (category, screenshot, admin reply) — add-if-missing for existing tables
alter table public.bug_reports add column if not exists category   text not null default 'bug';   -- bug | feature
alter table public.bug_reports add column if not exists image_data  text;          -- screenshot as a (client-resized) data URL
alter table public.bug_reports add column if not exists reply       text;          -- admin's reply to the reporter
alter table public.bug_reports add column if not exists replied_at  timestamptz;
alter table public.bug_reports add column if not exists replied_by  uuid references auth.users(id) on delete set null;

alter table public.bug_reports enable row level security;

drop policy if exists br_insert on public.bug_reports;
create policy br_insert on public.bug_reports for insert
  with check (reporter_id = auth.uid());

-- reporter sees (and so reads the admin reply on) their own reports; admins see all
drop policy if exists br_read on public.bug_reports;
create policy br_read on public.bug_reports for select
  using (reporter_id = auth.uid() or public.is_admin());

-- only admins change status / reply
drop policy if exists br_update on public.bug_reports;
create policy br_update on public.bug_reports for update
  using (public.is_admin()) with check (public.is_admin());

create index if not exists br_reporter_idx on public.bug_reports(reporter_id);
create index if not exists br_status_idx on public.bug_reports(status);
create index if not exists br_created_idx on public.bug_reports(created_at desc);
