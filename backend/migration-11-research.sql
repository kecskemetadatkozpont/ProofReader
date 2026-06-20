-- ============================================================================
--  Publify — migration 11: Research Management R0 (Foundation).
--  Research Project entity + research log + tasks + notifications, RLS-scoped to
--  the owner, the linked PhD student's supervisor(s), and admin. No external APIs
--  or compute yet (those are R1+). Run in the Supabase SQL editor. Idempotent.
--  Builds on migration-04 (is_admin), migration-07/08 (phd_students, phd_supervisions).
-- ============================================================================

-- ---- 1. tables -------------------------------------------------------------
create table if not exists research_projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references profiles(id) on delete cascade,
  student_id  uuid references phd_students(id) on delete set null,   -- optional PhD link
  title       text not null,
  field       text,
  keywords    text[],
  stage       int  not null default 0,          -- 0..7 (Setup..Submission)
  status      text not null default 'active',   -- active | paused | done | archived
  goal        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists rp_owner_idx on research_projects(owner_id);
create index if not exists rp_student_idx on research_projects(student_id);

create table if not exists research_log (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references research_projects(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  ts          timestamptz not null default now(),
  type        text not null default 'NOTE',     -- PROMPT|ARTIFACT|TASK|RESULT|DECISION|MILESTONE|NOTE
  summary     text not null,
  refs        text[],
  created_at  timestamptz not null default now()
);
create index if not exists rl_project_idx on research_log(project_id, ts desc);

create table if not exists research_tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references research_projects(id) on delete cascade,
  title       text not null,
  status      text not null default 'todo',     -- todo | doing | done
  stage       int,                              -- optional: which stage it belongs to
  due         date,
  assignee_id uuid references profiles(id) on delete set null,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists rt_project_idx on research_tasks(project_id);

create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  kind         text not null default 'info',    -- info | digest | request | job | deadline
  payload      jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists nf_recipient_idx on notifications(recipient_id, read_at);

-- ---- 2. access helpers (SECURITY DEFINER → no RLS recursion) ----------------
-- read: admin, owner, the linked student, or that student's supervisor (accepted or legacy primary)
create or replace function public.research_can_read_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.research_projects p where p.id = pid and (
      public.is_admin() or p.owner_id = auth.uid()
      or exists (select 1 from public.phd_students s where s.id = p.student_id
                 and (s.profile_id = auth.uid() or s.supervisor_id = auth.uid()))
      or exists (select 1 from public.phd_supervisions v
                 where v.student_id = p.student_id and v.supervisor_id = auth.uid() and v.status = 'accepted')
    )
  );
$$;
-- write: admin or owner (supervisors monitor read-only in R0)
create or replace function public.research_can_write_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.research_projects p where p.id = pid
      and (public.is_admin() or p.owner_id = auth.uid())
  );
$$;

-- ---- 3. RLS ----------------------------------------------------------------
alter table research_projects enable row level security;
drop policy if exists rp_read on research_projects;
create policy rp_read on research_projects for select to authenticated
  using (research_can_read_project(id));
drop policy if exists rp_insert on research_projects;
create policy rp_insert on research_projects for insert to authenticated
  with check (is_admin() or owner_id = auth.uid());
drop policy if exists rp_update on research_projects;
create policy rp_update on research_projects for update to authenticated
  using (research_can_write_project(id)) with check (research_can_write_project(id));
drop policy if exists rp_delete on research_projects;
create policy rp_delete on research_projects for delete to authenticated
  using (is_admin() or owner_id = auth.uid());

alter table research_log enable row level security;
drop policy if exists rl_read on research_log;
create policy rl_read on research_log for select to authenticated
  using (research_can_read_project(project_id));
drop policy if exists rl_insert on research_log;          -- anyone who can read may append their own entry (owner + supervisor notes)
create policy rl_insert on research_log for insert to authenticated
  with check (research_can_read_project(project_id) and profile_id = auth.uid());
drop policy if exists rl_delete on research_log;
create policy rl_delete on research_log for delete to authenticated
  using (is_admin() or profile_id = auth.uid());

alter table research_tasks enable row level security;
drop policy if exists rt_read on research_tasks;
create policy rt_read on research_tasks for select to authenticated
  using (research_can_read_project(project_id));
drop policy if exists rt_write on research_tasks;
create policy rt_write on research_tasks for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));

alter table notifications enable row level security;
drop policy if exists nf_read on notifications;
create policy nf_read on notifications for select to authenticated
  using (recipient_id = auth.uid() or is_admin());
drop policy if exists nf_insert on notifications;          -- app/worker create notifications (digest tightens in R2 via service-role)
create policy nf_insert on notifications for insert to authenticated
  with check (auth.uid() is not null);
drop policy if exists nf_update on notifications;
create policy nf_update on notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
drop policy if exists nf_delete on notifications;
create policy nf_delete on notifications for delete to authenticated
  using (recipient_id = auth.uid() or is_admin());

-- ---- 4. keep updated_at fresh ----------------------------------------------
create or replace function public.research_touch_project() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists rp_touch on research_projects;
create trigger rp_touch before update on research_projects
  for each row execute function public.research_touch_project();
