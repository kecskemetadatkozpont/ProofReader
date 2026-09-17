-- ============================================================================
--  Publify — migration 117: live lectures (slide decks, live sync, per-slide polls, activity).
--
--  A lecturer uploads a .pptx (stored in the existing course-media bucket under
--  '<course_id>/<uploader>/decks/…' — the migration-67 storage policies already
--  allow that), prepares polls per slide, then presents live: students follow the
--  current slide in real time (Realtime broadcast + course_live_sessions.current_slide
--  for late joiners), may browse back on their own, and answer the polls the
--  lecturer opens. Attendance and answers are kept for per-student activity reports.
--
--  Roles come from migration-66: course_is_member / course_is_instructor.
--  Apply in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

-- ---- 1. tables -------------------------------------------------------------

create table if not exists course_decks (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references courses(id) on delete cascade,
  lecture_id    uuid references course_lectures(id) on delete set null,
  title         text not null,
  storage_path  text not null,                        -- course-media: '<course_id>/<uploader>/decks/<id>.pptx'
  file_size     bigint,
  slide_count   int  not null default 0,
  slide_titles  jsonb not null default '[]'::jsonb,   -- ["Mi az MI és mi nem az?", …] — labels + reports
  created_by    uuid not null default auth.uid() references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists cdk_course_idx on course_decks(course_id, created_at desc);

-- poll TEMPLATES prepared per slide — lecturer-only (a quiz template holds the correct answer)
create table if not exists course_slide_polls (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses(id) on delete cascade,
  deck_id     uuid not null references course_decks(id) on delete cascade,
  slide_no    int  not null check (slide_no >= 1),
  ord         int  not null default 1,
  type        text not null check (type in ('single','multi','wordcloud','scale','open','quiz')),
  question    text not null check (length(question) between 1 and 500),
  options     jsonb not null default '[]'::jsonb,     -- ["A szöveg", "B szöveg"] for single/multi/quiz
  settings    jsonb not null default '{}'::jsonb,     -- {max_choices, max_words, min, max, min_label, max_label, correct}
  created_by  uuid not null default auth.uid() references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists csp_deck_idx on course_slide_polls(deck_id, slide_no, ord);

create table if not exists course_live_sessions (
  id             uuid primary key default gen_random_uuid(),
  course_id      uuid not null references courses(id) on delete cascade,
  deck_id        uuid not null references course_decks(id) on delete cascade,
  status         text not null default 'live' check (status in ('live','ended')),
  current_slide  int  not null default 1 check (current_slide >= 1),
  started_by     uuid not null default auth.uid() references profiles(id),
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  updated_at     timestamptz not null default now()
);
create index if not exists cls_course_idx on course_live_sessions(course_id, started_at desc);
-- one live lecture per course at a time
create unique index if not exists cls_one_live on course_live_sessions(course_id) where status = 'live';

-- a poll as LAUNCHED in a session — this is what students see (no correct answer until revealed)
create table if not exists course_poll_runs (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references course_live_sessions(id) on delete cascade,
  course_id     uuid not null references courses(id) on delete cascade,
  poll_id       uuid references course_slide_polls(id) on delete set null,   -- null = ad-hoc poll
  slide_no      int,
  type          text not null check (type in ('single','multi','wordcloud','scale','open','quiz')),
  question      text not null check (length(question) between 1 and 500),
  options       jsonb not null default '[]'::jsonb,
  settings      jsonb not null default '{}'::jsonb,   -- student-safe settings only (never the correct answer)
  status        text not null default 'open' check (status in ('open','closed')),
  show_results  boolean not null default false,
  correct       jsonb,                                -- quiz: set only when the lecturer reveals it
  created_by    uuid not null default auth.uid() references profiles(id),
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz
);
create index if not exists cpr_session_idx on course_poll_runs(session_id, opened_at);
create index if not exists cpr_course_idx  on course_poll_runs(course_id);

create table if not exists course_poll_answers (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references course_poll_runs(id) on delete cascade,
  course_id   uuid not null references courses(id) on delete cascade,
  user_id     uuid not null default auth.uid() references profiles(id) on delete cascade,
  answer      jsonb not null check (length(answer::text) < 4000),
  --  shapes: single/quiz {"choice":0} · multi {"choices":[0,2]} · scale {"value":4}
  --          wordcloud {"words":["adat","minta"]} · open {"text":"…"}
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (run_id, user_id)                            -- one answer per student per poll (editable while open)
);
create index if not exists cpa_course_user_idx on course_poll_answers(course_id, user_id);

-- attendance / activity per live session — written ONLY by course_session_ping (below)
create table if not exists course_session_attendance (
  session_id      uuid not null references course_live_sessions(id) on delete cascade,
  course_id       uuid not null references courses(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  active_seconds  int  not null default 0,
  slides_seen     int[] not null default '{}',
  max_slide       int  not null default 0,
  primary key (session_id, user_id)
);
create index if not exists csa_course_user_idx on course_session_attendance(course_id, user_id);

-- ---- 2. RLS ----------------------------------------------------------------

alter table course_decks              enable row level security;
alter table course_slide_polls        enable row level security;
alter table course_live_sessions      enable row level security;
alter table course_poll_runs          enable row level security;
alter table course_poll_answers       enable row level security;
alter table course_session_attendance enable row level security;

drop policy if exists cdk_read on course_decks;
create policy cdk_read  on course_decks for select to authenticated using (course_is_member(course_id));
drop policy if exists cdk_write on course_decks;
create policy cdk_write on course_decks for all to authenticated
  using (course_is_instructor(course_id)) with check (course_is_instructor(course_id));

drop policy if exists csp_all on course_slide_polls;
create policy csp_all on course_slide_polls for all to authenticated
  using (course_is_instructor(course_id)) with check (course_is_instructor(course_id));

drop policy if exists cls_read on course_live_sessions;
create policy cls_read  on course_live_sessions for select to authenticated using (course_is_member(course_id));
drop policy if exists cls_write on course_live_sessions;
create policy cls_write on course_live_sessions for all to authenticated
  using (course_is_instructor(course_id)) with check (course_is_instructor(course_id));

drop policy if exists cpr_read on course_poll_runs;
create policy cpr_read  on course_poll_runs for select to authenticated using (course_is_member(course_id));
drop policy if exists cpr_write on course_poll_runs;
create policy cpr_write on course_poll_runs for all to authenticated
  using (course_is_instructor(course_id)) with check (course_is_instructor(course_id));

-- answers: a member answers ONLY an open poll of their own course, as themselves; they read only their own
drop policy if exists cpa_read on course_poll_answers;
create policy cpa_read on course_poll_answers for select to authenticated
  using (user_id = auth.uid() or course_is_instructor(course_id));
drop policy if exists cpa_insert on course_poll_answers;
create policy cpa_insert on course_poll_answers for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from course_poll_runs r
                 where r.id = run_id and r.course_id = course_poll_answers.course_id
                   and r.status = 'open' and course_is_member(r.course_id)));
drop policy if exists cpa_update on course_poll_answers;
create policy cpa_update on course_poll_answers for update to authenticated
  using (user_id = auth.uid()
    and exists (select 1 from course_poll_runs r where r.id = run_id and r.status = 'open'))
  with check (user_id = auth.uid()
    and exists (select 1 from course_poll_runs r
                 where r.id = run_id and r.course_id = course_poll_answers.course_id and r.status = 'open'));
drop policy if exists cpa_delete on course_poll_answers;
create policy cpa_delete on course_poll_answers for delete to authenticated
  using (course_is_instructor(course_id));

drop policy if exists csa_read on course_session_attendance;
create policy csa_read on course_session_attendance for select to authenticated
  using (user_id = auth.uid() or course_is_instructor(course_id));
-- no insert/update policy: attendance is written only through course_session_ping

-- ---- 3. RPCs -----------------------------------------------------------------

-- aggregated results: the lecturer always; a member only once the lecturer shows them.
-- Open answers come back WITHOUT authors (anonymous wall).
create or replace function public.course_poll_results(p_run uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r course_poll_runs; res jsonb; n int;
begin
  select * into r from course_poll_runs where id = p_run;
  if r.id is null then return null; end if;
  if not (course_is_instructor(r.course_id) or (course_is_member(r.course_id) and r.show_results)) then
    raise exception 'Az eredmény még nem nyilvános.';
  end if;
  select count(*) into n from course_poll_answers where run_id = p_run;
  if r.type in ('single','quiz') then
    select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) into res
      from (select answer->>'choice' as k, count(*) as c from course_poll_answers
             where run_id = p_run and answer ? 'choice' group by 1) t;
  elsif r.type = 'multi' then
    select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) into res
      from (select v as k, count(*) as c from course_poll_answers a, jsonb_array_elements_text(a.answer->'choices') v
             where a.run_id = p_run group by 1) t;
  elsif r.type = 'scale' then
    select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) into res
      from (select answer->>'value' as k, count(*) as c from course_poll_answers
             where run_id = p_run and answer ? 'value' group by 1) t;
  elsif r.type = 'wordcloud' then
    select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) into res
      from (select lower(trim(v)) as k, count(*) as c from course_poll_answers a, jsonb_array_elements_text(a.answer->'words') v
             where a.run_id = p_run and length(trim(v)) > 0 group by 1 order by 2 desc limit 80) t;
  else
    select coalesce(jsonb_agg(t.text order by t.created_at desc), '[]'::jsonb) into res
      from (select answer->>'text' as text, created_at from course_poll_answers
             where run_id = p_run and length(coalesce(answer->>'text','')) > 0
             order by created_at desc limit 200) t;
  end if;
  return jsonb_build_object('type', r.type, 'total', n, 'data', res);
end $$;

-- presence heartbeat for activity reports. Active time is measured on the SERVER (time since the
-- last ping, capped at 90 s) so a client cannot inflate it by pinging fast or claiming seconds.
create or replace function public.course_session_ping(p_session uuid, p_slide int) returns void
language plpgsql security definer set search_path = public as $$
declare s course_live_sessions; sl int := greatest(coalesce(p_slide, 0), 0);
begin
  if auth.uid() is null then return; end if;
  select * into s from course_live_sessions where id = p_session;
  if s.id is null or s.status <> 'live' or not course_is_member(s.course_id) then return; end if;
  insert into course_session_attendance (session_id, course_id, user_id, slides_seen, max_slide)
    values (p_session, s.course_id, auth.uid(), case when sl > 0 then array[sl] else '{}'::int[] end, sl)
  on conflict (session_id, user_id) do update set
    active_seconds = course_session_attendance.active_seconds
      + least(greatest(extract(epoch from (now() - course_session_attendance.last_seen_at))::int, 0), 90),
    last_seen_at   = now(),
    slides_seen    = case when sl > 0 and not (sl = any(course_session_attendance.slides_seen))
                          then course_session_attendance.slides_seen || sl
                          else course_session_attendance.slides_seen end,
    max_slide      = greatest(course_session_attendance.max_slide, sl);
end $$;

revoke all on function public.course_poll_results(uuid)       from public, anon;
revoke all on function public.course_session_ping(uuid, int)  from public, anon;
grant execute on function public.course_poll_results(uuid), public.course_session_ping(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Verify after apply:
--   select count(*) from course_decks;                                        -- 0
--   select public.course_poll_results('00000000-0000-0000-0000-000000000000'); -- null
-- ---------------------------------------------------------------------------
