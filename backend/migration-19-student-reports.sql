-- migration-19 — supervisor daily student reports (LLM digest of a student's research activity).
-- One report per (student, day): an LLM summary of that day's AI chat + research_log + ideas + sources
-- + datasets/jobs, plus activity counts. Generated on demand by the supervisor or by a daily cron.
-- Builds on migration-11 (research_*), migration-12 (research_supervises), migration-07/08 (phd_*).

create table if not exists public.student_daily_reports (
  student_id    uuid not null references public.phd_students(id) on delete cascade,
  day           date not null,
  supervisor_id uuid references public.profiles(id) on delete set null,
  summary       jsonb not null default '{}'::jsonb,   -- { work_summary, decisions[], open_questions[], ideas[], topics[], blockers[] }
  chat_msgs     int not null default 0,
  log_entries   int not null default 0,
  ideas         int not null default 0,
  sources       int not null default 0,
  jobs          int not null default 0,
  generated_at  timestamptz not null default now(),
  model         text,
  primary key (student_id, day)
);

alter table public.student_daily_reports enable row level security;

-- read: admin, the student's supervisor(s), OR the student themselves (research_supervises covers all three).
drop policy if exists sdr_read on public.student_daily_reports;
create policy sdr_read on public.student_daily_reports for select
  using (public.is_admin() or public.research_supervises(student_id));

-- write: admin or supervisor (on-demand generation); the daily cron uses the service role (bypasses RLS).
drop policy if exists sdr_write on public.student_daily_reports;
create policy sdr_write on public.student_daily_reports for all
  using (public.is_admin() or public.research_supervises(student_id))
  with check (public.is_admin() or public.research_supervises(student_id));
