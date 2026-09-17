-- ============================================================================
--  Publify — migration 66: Course module core (courses + enrollment + labs).
--
--  Backs the "MI Alapok" course: courses, enrollments (role dimension), the
--  12-lecture outline, lab assignments (with per-lab MCP tool contract), lab
--  submissions and grades. Patterns: migration-11 (research_can_read/write
--  SECURITY DEFINER helpers + RLS), migration-08 (relation table with roles),
--  migration-49 (feature_catalog keys, hardened grants).
--
--  IMPORTANT: course entitlement lives HERE (course_enrollments + helpers),
--  NOT in profiles.features — the guard_profile_update self-lock trigger and
--  the migration-31/32/33 lockdown stay untouched. feature_catalog only gets
--  two keys: page_course (nav cosmetics) + course_mcp (mcp-bridge gate).
--
--  Apply in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

-- ---- 1. tables -------------------------------------------------------------

create table if not exists courses (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,                        -- 'MI Alapok 2026 ősz'
  slug          text unique,
  owner_id      uuid not null default auth.uid() references profiles(id),
  join_code     text unique not null default encode(gen_random_bytes(6),'hex'),
  student_model text not null default 'claude-haiku-4-5-20251001', -- course-level model policy
  settings      jsonb not null default '{}'::jsonb,   -- {max_video_per_team:1, locale:'hu', ...}
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists course_enrollments (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  role        text not null default 'hallgato',       -- 'oktato' | 'demonstrator' | 'hallgato'
  team        text,                                   -- capstone team (week 8-9 video/audio lab)
  anon_canvas boolean not null default false,         -- GDPR: canvas anonymity opt-in (default)
  status      text not null default 'active',         -- active | dropped
  created_at  timestamptz not null default now(),
  unique (course_id, user_id)
);
create index if not exists ce_course_idx on course_enrollments(course_id);
create index if not exists ce_user_idx   on course_enrollments(user_id);

create table if not exists course_lectures (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references courses(id) on delete cascade,
  ord        int  not null,                           -- 1..12
  title      text not null,
  summary    text,
  content_md text,                                    -- lecture material / lab-book header markdown
  held_at    date,
  visible    boolean not null default false,          -- the instructor "arms" it at lecture start
  unique (course_id, ord)
);

create table if not exists lab_assignments (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references courses(id) on delete cascade,
  lecture_id      uuid not null references course_lectures(id) on delete cascade,
  ord             int  not null default 1,
  title           text not null,
  instructions_md text,                               -- step-by-step lab book
  submit_kinds    text[] not null default '{text,link,media}', -- accepted submission kinds
  mcp_profile     jsonb not null default '{}'::jsonb,
  --  ^ the lab's MCP tool contract, enforced by the mcp-bridge edge fn:
  --  {"providers":["anthropic-mcp","gemini"],
  --   "servers":{"higgsfield":{"allowed_tools":["generate_image","upscale_image"]},
  --              "consensus":{"allowed_tools":["search"]}},
  --   "model_max":"claude-sonnet-4-6",
  --   "credit_cost":{"generate_image":5,"generate_video":60,"llm_call":1}}
  due_at          timestamptz,
  team_based      boolean not null default false,     -- week-8 video: P0 model is per-student
                                                      -- submissions (unique assignment_id,user_id);
                                                      -- the instructor UI groups them by team
  points_max      numeric not null default 10,
  rubric          jsonb,                              -- [{key,label,points}]
  visible         boolean not null default false
);
create index if not exists la_course_idx on lab_assignments(course_id, lecture_id);

create table if not exists lab_submissions (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references lab_assignments(id) on delete cascade,
  course_id      uuid not null references courses(id) on delete cascade,
  user_id        uuid not null default auth.uid() references profiles(id) on delete cascade,
  team           text,                                -- required for team_based labs
  kind           text not null default 'text',        -- text | link | media
  body_text      text,
  link_url       text,
  media_path     text,                                -- course-media bucket path (migration-67)
  media_mime     text,
  canvas_item_id uuid,                                -- posted from the canvas (provenance chain;
                                                      -- soft ref — canvas table lands in migration-68)
  call_log_ids   bigint[],                            -- mcp_call_log rows = generation provenance
  status         text not null default 'submitted',   -- draft | submitted | returned | graded
  submitted_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (assignment_id, user_id)                     -- 1 submission / student / lab (upsert updates)
);
create index if not exists ls_assignment_idx  on lab_submissions(assignment_id);
create index if not exists ls_course_user_idx on lab_submissions(course_id, user_id);

create table if not exists lab_grades (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references lab_submissions(id) on delete cascade,
  course_id     uuid not null references courses(id) on delete cascade,
  grader_id     uuid not null default auth.uid() references profiles(id),
  points        numeric not null,
  rubric_scores jsonb,                                -- {key: points, ...}
  feedback_md   text,
  created_at    timestamptz not null default now(),
  unique (submission_id)                              -- 1 grade / submission (upsert overwrites)
);

-- ---- 2. helpers (research_can_read_project pattern, SECURITY DEFINER) ------

create or replace function public.course_role(cid uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from course_enrollments
  where course_id = cid and user_id = auth.uid() and status = 'active' limit 1;
$$;

create or replace function public.course_is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.course_role(cid) is not null;
$$;

create or replace function public.course_is_instructor(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or public.course_role(cid) in ('oktato','demonstrator')
      or exists (select 1 from courses c where c.id = cid and c.owner_id = auth.uid());
$$;

revoke all on function public.course_role(uuid)          from public, anon;
revoke all on function public.course_is_member(uuid)     from public, anon;
revoke all on function public.course_is_instructor(uuid) from public, anon;
grant execute on function public.course_role(uuid),
  public.course_is_member(uuid), public.course_is_instructor(uuid) to authenticated;

-- ---- 3. RLS ----------------------------------------------------------------

alter table courses            enable row level security;
alter table course_enrollments enable row level security;
alter table course_lectures    enable row level security;
alter table lab_assignments    enable row level security;
alter table lab_submissions    enable row level security;
alter table lab_grades         enable row level security;

-- courses: member reads, instructor/admin writes; admin creates the course
-- and appoints the instructor (owner_id) — instructors administer from there on.
drop policy if exists courses_read on courses;
create policy courses_read   on courses for select to authenticated using (course_is_member(id));
drop policy if exists courses_write on courses;
create policy courses_write  on courses for update to authenticated
  using (course_is_instructor(id)) with check (course_is_instructor(id));
drop policy if exists courses_insert on courses;
create policy courses_insert on courses for insert to authenticated with check (is_admin());
drop policy if exists courses_delete on courses;
create policy courses_delete on courses for delete to authenticated using (is_admin());

-- enrollments: the student sees their OWN row + the instructor the course's
-- (NOT a profiles relaxation — migration-31/32/33 lockdown untouched)
drop policy if exists ce_read on course_enrollments;
create policy ce_read on course_enrollments for select to authenticated
  using (user_id = auth.uid() or course_is_instructor(course_id));
drop policy if exists ce_write on course_enrollments;
create policy ce_write on course_enrollments for all to authenticated
  using (course_is_instructor(course_id)) with check (course_is_instructor(course_id));
-- student self-insert goes ONLY through the join-code RPC (course_join below)

-- lectures/assignments: member reads (students only visible=true), instructor writes
drop policy if exists cl_read on course_lectures;
create policy cl_read on course_lectures for select to authenticated
  using (course_is_member(course_id) and (visible or course_is_instructor(course_id)));
drop policy if exists cl_write on course_lectures;
create policy cl_write on course_lectures for all to authenticated
  using (course_is_instructor(course_id)) with check (course_is_instructor(course_id));

drop policy if exists la_read on lab_assignments;
create policy la_read on lab_assignments for select to authenticated
  using (course_is_member(course_id) and (visible or course_is_instructor(course_id)));
drop policy if exists la_write on lab_assignments;
create policy la_write on lab_assignments for all to authenticated
  using (course_is_instructor(course_id)) with check (course_is_instructor(course_id));

-- submissions: student their OWN (+ teammate's when team_based), instructor all in course
-- team read opens ONLY for active enrollees and ONLY on team_based assignments
-- (review fix — a stale team label on a dropped enrollee, or a team label on a
-- solo lab, must not leak peers' submissions).
drop policy if exists ls_read on lab_submissions;
create policy ls_read on lab_submissions for select to authenticated
  using (user_id = auth.uid()
     or course_is_instructor(course_id)
     or (team is not null
         and exists (select 1 from lab_assignments a
               where a.id = lab_submissions.assignment_id and a.team_based)
         and exists (select 1 from course_enrollments e
               where e.course_id = lab_submissions.course_id
                 and e.user_id = auth.uid() and e.status = 'active'
                 and e.team = lab_submissions.team)));
-- review fix: a student may only stamp their OWN enrollment's team onto a
-- submission (no joining someone else's team by typing its name).
drop policy if exists ls_insert on lab_submissions;
create policy ls_insert on lab_submissions for insert to authenticated
  with check (user_id = auth.uid() and course_is_member(course_id)
    and (team is null or team = (select team from course_enrollments e2
          where e2.course_id = lab_submissions.course_id
            and e2.user_id = auth.uid() and e2.status = 'active')));
drop policy if exists ls_update on lab_submissions;
create policy ls_update on lab_submissions for update to authenticated
  using (user_id = auth.uid() or course_is_instructor(course_id))
  with check ((user_id = auth.uid()
      and (team is null or team = (select team from course_enrollments e2
            where e2.course_id = lab_submissions.course_id
              and e2.user_id = auth.uid() and e2.status = 'active')))
    or course_is_instructor(course_id));
drop policy if exists ls_delete on lab_submissions;
create policy ls_delete on lab_submissions for delete to authenticated
  using (user_id = auth.uid() or course_is_instructor(course_id));

-- Provenance-forgery guard (review fix, same pattern as guard_canvas_provenance
-- in migration-68): EVERY element of call_log_ids must be the caller's OWN,
-- same-course mcp_call_log row, and media_path must live under the caller's
-- '<course_id>/<auth.uid()>/' folder. Instructor (and the service client,
-- auth.uid() is null there) bypasses. NOTE: mcp_call_log lands in migration-67 —
-- plpgsql resolves the table at CALL time, so creating the function here is
-- safe; just apply 66 before any student submits with call_log_ids.
create or replace function public.guard_submission_provenance() returns trigger
language plpgsql security definer set search_path = public as $$
declare bad int;
begin
  if auth.uid() is null or course_is_instructor(new.course_id) then return new; end if;
  if new.call_log_ids is not null and array_length(new.call_log_ids, 1) > 0 then
    select count(*) into bad
      from unnest(new.call_log_ids) as cl(id)
      left join mcp_call_log l
        on l.id = cl.id and l.user_id = auth.uid() and l.course_id = new.course_id
     where l.id is null;
    if bad > 0 then
      raise exception 'A call_log_ids csak saját, ehhez a kurzushoz tartozó hívásokat tartalmazhat.';
    end if;
  end if;
  if new.media_path is not null
     and new.media_path not like (new.course_id::text || '/' || auth.uid()::text || '/%') then
    raise exception 'A media_path csak a saját kurzus-mappádra mutathat.';
  end if;
  return new;
end; $$;
drop trigger if exists guard_submission_provenance_trg on lab_submissions;
create trigger guard_submission_provenance_trg before insert or update on lab_submissions
  for each row execute function public.guard_submission_provenance();

-- grades: instructor writes, the student reads the grade of their own submission
drop policy if exists lg_read on lab_grades;
create policy lg_read on lab_grades for select to authenticated
  using (course_is_instructor(course_id)
     or exists (select 1 from lab_submissions s where s.id = submission_id and s.user_id = auth.uid()));
drop policy if exists lg_write on lab_grades;
create policy lg_write on lab_grades for all to authenticated
  using (course_is_instructor(course_id)) with check (course_is_instructor(course_id));

-- ---- 4. join-code redemption -----------------------------------------------
--  SECURITY DEFINER — the single narrow path around the ce_write policy
--  (same pattern as the pr_* RPCs): a student can ONLY enroll themselves,
--  only as 'hallgato', only into an active course with a valid code.
create or replace function public.course_join(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not public.is_active() then raise exception 'A fiók még nincs jóváhagyva.'; end if;
  select id into cid from courses where join_code = p_code and active;
  if cid is null then raise exception 'Érvénytelen kurzuskód'; end if;
  -- review fix: a dropped (instructor-removed) enrollment must NOT re-activate
  -- itself with the join code — the WHERE below skips the update for dropped
  -- rows, so FOUND=false happens EXACTLY in that case (fresh insert and a
  -- non-dropped conflict both set FOUND=true).
  insert into course_enrollments (course_id, user_id, role)
    values (cid, auth.uid(), 'hallgato')
    on conflict (course_id, user_id) do update set status = 'active'
      where course_enrollments.status <> 'dropped';
  if not found then
    raise exception 'A kurzusból eltávolítottak — kérj új hozzáférést az oktatótól.';
  end if;
  return cid;
end; $$;
revoke all on function public.course_join(text) from public, anon;
grant execute on function public.course_join(text) to authenticated;

--  rotate_join_code: instructor-only — invalidates a leaked join code by
--  generating (and returning) a fresh one. SECURITY DEFINER, same narrow-path
--  pattern as course_join.
create or replace function public.rotate_join_code(p_course uuid) returns text
language plpgsql security definer set search_path = public as $$
declare new_code text;
begin
  if not course_is_instructor(p_course) then
    raise exception 'Csak oktató generálhat új kurzuskódot';
  end if;
  new_code := encode(gen_random_bytes(6),'hex');
  update courses set join_code = new_code where id = p_course;
  if not found then raise exception 'A kurzus nem található'; end if;
  return new_code;
end; $$;
revoke all on function public.rotate_join_code(uuid) from public, anon;
grant execute on function public.rotate_join_code(uuid) to authenticated;

-- ---- 5. feature_catalog keys (migration-49 matrix) ---------------------------
--  page_course: nav cosmetics only (enforced=false); course_mcp: the mcp-bridge
--  edge fn gate (enforced=true). Both default_on — the REAL boundary is the
--  course_enrollments membership (course_is_member/instructor above).
insert into public.feature_catalog (key,label,category,default_on,enforced,sort) values
  ('page_course', 'Course workspace (nav)',      'page', true, false, 250),
  ('course_mcp',  'Course MCP Bridge (labs)',    'ai',   true, true,  260)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Verify after apply:
--   select public.course_role('00000000-0000-0000-0000-000000000000');  -- null
--   select key from feature_catalog where key in ('page_course','course_mcp'); -- 2 rows
-- ---------------------------------------------------------------------------
