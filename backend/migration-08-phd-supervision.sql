-- ============================================================================
--  Publify — migration 08: self-service roles + student↔supervisor request/accept.
--  A user marks themselves supervisor/student; a student requests one or more
--  supervisors (primary + co); each supervisor accepts/rejects; on accept the
--  supervisor sees & manages that student's KPIs. Admin overrides everything.
--  Run in the Supabase SQL editor. Idempotent. Builds on migration-04 (is_admin)
--  and migration-07 (phd_* tables, phd_can_read/write_student).
-- ============================================================================

-- ---- 1. supervisor "open to new requests" flag -----------------------------
alter table profiles add column if not exists accepting_students boolean not null default true;

-- ---- 2. supervision relationship (request → accept), many-per-student ------
create table if not exists phd_supervisions (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references phd_students(id) on delete cascade,
  supervisor_id uuid not null references profiles(id) on delete cascade,
  kind          text not null default 'primary',   -- primary | co
  status        text not null default 'pending',   -- pending | accepted | rejected
  message       text,                              -- optional note from the student
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  unique (student_id, supervisor_id)
);
create index if not exists phd_sv_student_idx on phd_supervisions(student_id);
create index if not exists phd_sv_supervisor_idx on phd_supervisions(supervisor_id);

-- helper: does the current user OWN this student record (i.e. is the student)?
create or replace function public.phd_owns_student(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.phd_students s where s.id = sid and s.profile_id = auth.uid());
$$;

-- ---- 3. read/write helpers now honour ACCEPTED supervisions ----------------
create or replace function public.phd_can_read_student(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.phd_students s where s.id = sid and (
      public.is_admin() or s.profile_id = auth.uid() or s.supervisor_id = auth.uid()
      or exists (select 1 from public.phd_supervisions v where v.student_id = sid and v.supervisor_id = auth.uid() and v.status = 'accepted')
    )
  );
$$;
create or replace function public.phd_can_write_student(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.phd_students s where s.id = sid and (
      public.is_admin() or s.supervisor_id = auth.uid()
      or exists (select 1 from public.phd_supervisions v where v.student_id = sid and v.supervisor_id = auth.uid() and v.status = 'accepted')
    )
  );
$$;

-- ---- 4. RLS: phd_supervisions ----------------------------------------------
alter table phd_supervisions enable row level security;
-- read: admin, the student, or the addressed supervisor
drop policy if exists phd_sv_read on phd_supervisions;
create policy phd_sv_read on phd_supervisions for select to authenticated
  using (is_admin() or supervisor_id = auth.uid() or phd_owns_student(student_id));
-- the student requests (insert) only for their own student record, as 'pending'
drop policy if exists phd_sv_request on phd_supervisions;
create policy phd_sv_request on phd_supervisions for insert to authenticated
  with check (is_admin() or (phd_owns_student(student_id) and status = 'pending'));
-- the supervisor decides (accept/reject) on requests addressed to them; admin any
drop policy if exists phd_sv_decide on phd_supervisions;
create policy phd_sv_decide on phd_supervisions for update to authenticated
  using (is_admin() or supervisor_id = auth.uid())
  with check (is_admin() or supervisor_id = auth.uid());
-- the student may cancel their own request; the supervisor or admin may remove
drop policy if exists phd_sv_delete on phd_supervisions;
create policy phd_sv_delete on phd_supervisions for delete to authenticated
  using (is_admin() or supervisor_id = auth.uid() or phd_owns_student(student_id));

-- keep phd_students.supervisor_id in sync with the accepted PRIMARY supervision
create or replace function public.phd_sync_primary() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'accepted' and new.kind = 'primary' then
    update public.phd_students set supervisor_id = new.supervisor_id, updated_at = now() where id = new.student_id;
  end if;
  if tg_op = 'UPDATE' and new.status <> 'accepted' and old.status = 'accepted' and old.kind = 'primary' then
    update public.phd_students set supervisor_id = null where id = new.student_id and supervisor_id = old.supervisor_id;
  end if;
  return new;
end; $$;
drop trigger if exists phd_sync_primary_trg on phd_supervisions;
create trigger phd_sync_primary_trg after insert or update on phd_supervisions
  for each row execute function public.phd_sync_primary();

-- ---- 5. RLS: phd_students — self-register + self-edit (KPIs stay protected) -
-- read: admin, the student, a legacy primary, OR an accepted supervisor
drop policy if exists phd_students_read on phd_students;
create policy phd_students_read on phd_students for select to authenticated
  using (
    is_admin() or profile_id = auth.uid() or supervisor_id = auth.uid()
    or exists (select 1 from phd_supervisions v where v.student_id = phd_students.id and v.supervisor_id = auth.uid() and v.status = 'accepted')
  );
-- a user may self-register exactly one student record for themselves; admin any
drop policy if exists phd_students_insert on phd_students;
create policy phd_students_insert on phd_students for insert to authenticated
  with check (is_admin() or profile_id = auth.uid());
-- update: admin, an accepted supervisor, a legacy primary, or the student (guarded)
drop policy if exists phd_students_write on phd_students;            -- (replaces migration-07's combined policy)
drop policy if exists phd_students_update on phd_students;
create policy phd_students_update on phd_students for update to authenticated
  using (is_admin() or supervisor_id = auth.uid() or profile_id = auth.uid()
         or exists (select 1 from phd_supervisions v where v.student_id = phd_students.id and v.supervisor_id = auth.uid() and v.status = 'accepted'))
  with check (true);
drop policy if exists phd_students_delete on phd_students;
create policy phd_students_delete on phd_students for delete to authenticated
  using (is_admin() or supervisor_id = auth.uid() or profile_id = auth.uid());

-- a student editing their OWN record may only touch basic fields; KPI fields are
-- reverted (only an accepted supervisor / admin may change credits/status/etc.)
create or replace function public.guard_phd_student_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  if exists (select 1 from public.phd_supervisions v where v.student_id = old.id and v.supervisor_id = auth.uid() and v.status = 'accepted') then return new; end if;
  if old.supervisor_id = auth.uid() then return new; end if;          -- legacy primary supervisor
  -- otherwise the editor is the student themselves: protect the KPI fields
  new.total_credits := old.total_credits;
  new.status        := old.status;
  new.ethics_status := old.ethics_status;
  new.complex_exam  := old.complex_exam;
  new.supervisor_id := old.supervisor_id;
  return new;
end; $$;
drop trigger if exists guard_phd_student_update_trg on phd_students;
create trigger guard_phd_student_update_trg before update on phd_students
  for each row execute function public.guard_phd_student_update();

-- ============================================================================
--  After this runs: phase-2 UI (role self-service), phase-3 (request + inbox),
--  phase-4 (admin role/relationship panel).
-- ============================================================================
