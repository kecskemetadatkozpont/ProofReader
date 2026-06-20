-- ============================================================================
--  Publify — migration 07: Doctoral School manager (ported from doktori-iskola-menedzser)
--  Roles (supervisor/student) on profiles + student lifecycle tables. Run in the
--  Supabase SQL editor. Idempotent. Uses public.is_admin() (migration-04).
-- ============================================================================

-- ---- 1. roles on profiles --------------------------------------------------
alter table profiles add column if not exists is_supervisor      boolean not null default false;
alter table profiles add column if not exists is_student         boolean not null default false;
alter table profiles add column if not exists department         text;
alter table profiles add column if not exists capacity_max       int;          -- supervisor: max students
alter table profiles add column if not exists research_interests text[];        -- supervisor: topics/keywords

-- existing researchers double as supervisors; seed department from their affiliation
update profiles set is_supervisor = true where is_researcher = true and is_supervisor = false;
update profiles set department = affiliation where is_supervisor = true and (department is null or department = '');
update profiles set capacity_max = 4 where is_supervisor = true and capacity_max is null;

-- ---- 2. students (managed records; optional link to a real account) --------
create table if not exists phd_students (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid references profiles(id) on delete set null,   -- the student's own login, if any
  name             text not null,
  email            text,
  enrollment_year  int,
  supervisor_id    uuid references profiles(id) on delete set null,
  topic            text,
  status           text not null default 'Aktív',     -- Aktív | Passzív | Fokozatot szerzett | Lemorzsolódott | Abszolutórium
  total_credits    int not null default 0,
  required_credits int not null default 240,
  ethics_status    text default 'NONE',               -- NONE | PENDING | APPROVED | REJECTED
  complex_exam     jsonb,                              -- { status, plannedDate, committee[], resultGrade }
  avatar_url       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists phd_students_supervisor_idx on phd_students(supervisor_id);
create index if not exists phd_students_profile_idx on phd_students(profile_id);

-- ---- 3. milestones / degree requirements / tasks (per student) -------------
create table if not exists phd_milestones (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references phd_students(id) on delete cascade,
  title           text not null,
  type            text,                               -- Tanegység | Publikáció | Vizsga | Oktatás | Disszertáció
  credits         int default 0,
  deadline        date,
  status          text default 'Tervezett',           -- Tervezett | Folyamatban | Teljesítve | Sikertelen
  description     text,
  completion_date date,
  proof           jsonb,                              -- { name, storage_path, status } — uploaded evidence
  created_at      timestamptz not null default now()
);
create index if not exists phd_milestones_student_idx on phd_milestones(student_id);

create table if not exists phd_degree_requirements (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references phd_students(id) on delete cascade,
  title         text not null,
  category      text,                                 -- SCIENTIFIC | ACADEMIC | TEACHING
  target_value  numeric default 0,
  current_value numeric default 0,
  unit          text,
  is_auto       boolean default false,
  description   text
);
create index if not exists phd_degree_req_student_idx on phd_degree_requirements(student_id);

create table if not exists phd_tasks (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references phd_students(id) on delete cascade,
  title       text not null,
  description text,
  status      text default 'TODO',                    -- TODO | IN_PROGRESS | DONE
  priority    text default 'MEDIUM',                  -- LOW | MEDIUM | HIGH
  due_date    date,
  created_at  timestamptz not null default now()
);
create index if not exists phd_tasks_student_idx on phd_tasks(student_id);

-- ---- 4. open PhD topics (the project board) --------------------------------
create table if not exists phd_topics (
  id            uuid primary key default gen_random_uuid(),
  supervisor_id uuid references profiles(id) on delete set null,
  title         text not null,
  description   text,
  tags          text[],
  status        text default 'OPEN',                  -- OPEN | CLOSED
  created_at    timestamptz not null default now()
);
create index if not exists phd_topics_supervisor_idx on phd_topics(supervisor_id);

-- ---- 5. row-level security -------------------------------------------------
alter table phd_students            enable row level security;
alter table phd_milestones          enable row level security;
alter table phd_degree_requirements enable row level security;
alter table phd_tasks               enable row level security;
alter table phd_topics              enable row level security;

-- helper: is the given student "mine" to read (admin OR their supervisor OR the student)?
create or replace function public.phd_can_read_student(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.phd_students s
    where s.id = sid and (public.is_admin() or s.supervisor_id = auth.uid() or s.profile_id = auth.uid())
  );
$$;
-- helper: may I manage (write) this student? (admin OR their supervisor)
create or replace function public.phd_can_write_student(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.phd_students s
    where s.id = sid and (public.is_admin() or s.supervisor_id = auth.uid())
  );
$$;

-- students
drop policy if exists phd_students_read on phd_students;
create policy phd_students_read on phd_students for select to authenticated
  using (is_admin() or supervisor_id = auth.uid() or profile_id = auth.uid());
drop policy if exists phd_students_write on phd_students;
create policy phd_students_write on phd_students for all to authenticated
  using  (is_admin() or supervisor_id = auth.uid())
  with check (is_admin() or supervisor_id = auth.uid());

-- per-student child tables: read if you can read the student; write if you can manage them
drop policy if exists phd_ms_read on phd_milestones;
create policy phd_ms_read on phd_milestones for select to authenticated using (phd_can_read_student(student_id));
drop policy if exists phd_ms_write on phd_milestones;
create policy phd_ms_write on phd_milestones for all to authenticated using (phd_can_write_student(student_id)) with check (phd_can_write_student(student_id));

drop policy if exists phd_dr_read on phd_degree_requirements;
create policy phd_dr_read on phd_degree_requirements for select to authenticated using (phd_can_read_student(student_id));
drop policy if exists phd_dr_write on phd_degree_requirements;
create policy phd_dr_write on phd_degree_requirements for all to authenticated using (phd_can_write_student(student_id)) with check (phd_can_write_student(student_id));

drop policy if exists phd_tasks_read on phd_tasks;
create policy phd_tasks_read on phd_tasks for select to authenticated using (phd_can_read_student(student_id));
drop policy if exists phd_tasks_write on phd_tasks;
create policy phd_tasks_write on phd_tasks for all to authenticated using (phd_can_write_student(student_id)) with check (phd_can_write_student(student_id));

-- topics: any signed-in user may browse the open board; supervisors/admin post their own
drop policy if exists phd_topics_read on phd_topics;
create policy phd_topics_read on phd_topics for select to authenticated using (true);
drop policy if exists phd_topics_write on phd_topics;
create policy phd_topics_write on phd_topics for all to authenticated
  using  (is_admin() or supervisor_id = auth.uid())
  with check (is_admin() or supervisor_id = auth.uid());

-- ============================================================================
--  After this runs: seed-phd.mjs adds research_interests to the supervisors and
--  a few demo students (with milestones/requirements/tasks) + open topics.
-- ============================================================================
