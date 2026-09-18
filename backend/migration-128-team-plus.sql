-- migration-128-team-plus.sql
-- Öt bővítés a csapat-munkatérhez:
--   1. Az oktató/admin mostantól ÍRHAT is a csapatok munkaterébe (segítés, javítás).
--   2. Csapat-chat (team_messages) valós idejű frissítéssel, üzenetből feladat/szertartás.
--   3. Csapat-dokumentumtár (team_docs) — feladathoz nem kötött fájlok.
--   4. Órai pontok: szavazás-részvétel és helyes kvízválasz alapján, egyéni és csapatszinten.
--   5. A csapat-áttekintő kiegészítése dokumentum- és üzenetszámmal, pontokkal.
--
-- Előfeltétel: migration-117 (élő előadás szavazások), 122-127.
-- Ellenőrzés:
--   select public.course_points('<course-uuid>') -> 'teams';
--   select count(*) from information_schema.tables where table_name in ('team_messages','team_docs');  -- 2

-- ---- 1. az oktató is írhat ---------------------------------------------------
-- A betekintés marad az alapértelmezett élmény (a felület jelzi is), de amikor
-- segíteni kell, az oktató ugyanazokat a gombokat kapja, mint a csapat.
create or replace function public.team_can_write(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from course_team_members m where m.team_id = p_team and m.user_id = auth.uid())
      or exists (select 1 from course_teams t where t.id = p_team and course_is_instructor(t.course_id));
$$;

-- ---- 2. csapat-chat ----------------------------------------------------------
create table if not exists team_messages (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references course_teams(id) on delete cascade,
  course_id  uuid not null references courses(id) on delete cascade,
  author     uuid not null references profiles(id) on delete cascade,
  body       text not null,
  task_id    uuid references team_tasks(id) on delete set null,   -- ha egy feladatról szól
  meta       jsonb not null default '{}'::jsonb,                  -- {from:'task'|'daily'|…, ref:…}
  created_at timestamptz not null default now()
);
create index if not exists tm_team_idx on team_messages(team_id, created_at desc);
alter table team_messages enable row level security;
drop policy if exists tm_read on team_messages;
create policy tm_read on team_messages for select to authenticated using (team_can_read(team_id));
do $$ begin
  alter publication supabase_realtime add table team_messages;     -- élő chat
exception when duplicate_object then null; end $$;

create or replace function public.team_message_send(p_team uuid, p_body text, p_task uuid default null, p_meta jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; mid uuid; txt text;
begin
  if not team_can_write(p_team) then raise exception 'Csak a csapat tagjai (és az oktató) írhatnak ide'; end if;
  txt := btrim(coalesce(p_body, ''));
  if txt = '' then raise exception 'Üres üzenet.'; end if;
  select course_id into cid from course_teams where id = p_team;
  insert into team_messages (team_id, course_id, author, body, task_id, meta)
  values (p_team, cid, auth.uid(), left(txt, 4000), p_task, coalesce(p_meta, '{}'::jsonb))
  returning id into mid;
  return mid;
end; $$;

create or replace function public.team_message_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m record; my_role text;
begin
  select * into m from team_messages where id = p_id;
  if m is null then return; end if;
  select role into my_role from course_team_members where team_id = m.team_id and user_id = auth.uid();
  if m.author <> auth.uid() and coalesce(my_role, '') not in ('po', 'sm') and not course_is_instructor(m.course_id) then
    raise exception 'Csak a szerzője, a Product Owner, a Scrum Master vagy az oktató törölheti.';
  end if;
  delete from team_messages where id = p_id;
end; $$;

create or replace function public.team_messages_list(p_team uuid, p_limit int default 200)
returns table (id uuid, author uuid, author_name text, body text, task_id uuid, task_title text,
               meta jsonb, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not team_can_read(p_team) then raise exception 'Nincs hozzáférésed'; end if;
  return query
    select x.id, x.author, x.author_name, x.body, x.task_id, x.task_title, x.meta, x.created_at from (
      select m.id, m.author, p.name as author_name, m.body, m.task_id, k.title as task_title,
             m.meta, m.created_at
        from team_messages m
        left join profiles p   on p.id = m.author
        left join team_tasks k on k.id = m.task_id
       where m.team_id = p_team
       order by m.created_at desc
       limit greatest(1, least(coalesce(p_limit, 200), 500))) x
    order by x.created_at;
end; $$;

-- Üzenetből feladat: a szöveg lesz a cím, az üzenet pedig hozzákapcsolódik.
create or replace function public.team_message_to_task(p_message uuid, p_title text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare m record; tid uuid; sid uuid; ttl text;
begin
  select * into m from team_messages where id = p_message;
  if m is null then raise exception 'Nincs ilyen üzenet'; end if;
  if not team_can_write(m.team_id) then raise exception 'Nincs jogosultság'; end if;
  ttl := left(btrim(coalesce(nullif(btrim(coalesce(p_title, '')), ''), m.body)), 200);
  if length(ttl) < 2 then raise exception 'Túl rövid ahhoz, hogy feladat legyen.'; end if;
  select id into sid from team_sprints where team_id = m.team_id and current_date between starts_on and ends_on;
  insert into team_tasks (team_id, course_id, sprint_id, title, detail, created_by, ord)
  values (m.team_id, m.course_id, sid, ttl,
          case when ttl <> m.body then m.body else null end, auth.uid(), extract(epoch from now()))
  returning id into tid;
  update team_messages set task_id = tid, meta = meta || jsonb_build_object('became_task', true) where id = p_message;
  return tid;
end; $$;

-- Üzenetből szertartás-bejegyzés: a saját daily/planning/retro adott mezőjébe fűzi.
create or replace function public.team_message_to_event(p_message uuid, p_kind text, p_field text)
returns uuid language plpgsql security definer set search_path = public as $$
declare m record; cur jsonb; merged jsonb; existing text;
begin
  select * into m from team_messages where id = p_message;
  if m is null then raise exception 'Nincs ilyen üzenet'; end if;
  if not team_can_write(m.team_id) then raise exception 'Nincs jogosultság'; end if;
  if p_kind not in ('planning', 'daily', 'retro') then raise exception 'Ismeretlen szertartás'; end if;
  select payload into cur from team_events
   where team_id = m.team_id and kind = p_kind and author = auth.uid()
     and day = case p_kind when 'daily' then current_date
                           when 'planning' then (select starts_on from team_sprints where team_id = m.team_id and current_date between starts_on and ends_on)
                           else (select ends_on from team_sprints where team_id = m.team_id and current_date between starts_on and ends_on) end;
  existing := coalesce(cur->>p_field, '');
  merged := coalesce(cur, '{}'::jsonb) || jsonb_build_object(p_field,
    case when existing = '' then m.body else existing || E'\n' || m.body end);
  return team_event_save(m.team_id, p_kind, merged, case when p_kind = 'daily' then current_date else null end);
end; $$;

-- ---- 3. dokumentumtár --------------------------------------------------------
create table if not exists team_docs (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references course_teams(id) on delete cascade,
  course_id    uuid not null references courses(id) on delete cascade,
  kind         text not null default 'file' check (kind in ('file', 'link')),
  name         text not null,
  note         text,
  storage_path text,
  url          text,
  size         bigint,
  mime         text,
  uploaded_by  uuid not null references profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists td_team_idx on team_docs(team_id, created_at desc);
alter table team_docs enable row level security;
drop policy if exists td_read on team_docs;
create policy td_read on team_docs for select to authenticated using (team_can_read(team_id));

create or replace function public.team_doc_add(p_team uuid, p_kind text, p_name text, p_note text default null,
  p_path text default null, p_url text default null, p_size bigint default null, p_mime text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; did uuid;
begin
  if not team_can_write(p_team) then raise exception 'Csak a csapat tagjai (és az oktató) tölthetnek fel'; end if;
  if p_kind not in ('file', 'link') then raise exception 'Ismeretlen típus'; end if;
  if p_kind = 'file' and coalesce(p_path, '') = '' then raise exception 'Hiányzik a fájl útvonala'; end if;
  if p_kind = 'link' and coalesce(p_url, '') !~ '^https?://' then raise exception 'A link http(s) címmel kezdődjön.'; end if;
  select course_id into cid from course_teams where id = p_team;
  insert into team_docs (team_id, course_id, kind, name, note, storage_path, url, size, mime, uploaded_by)
  values (p_team, cid, p_kind, left(btrim(coalesce(p_name, 'dokumentum')), 200),
          nullif(btrim(coalesce(p_note, '')), ''), p_path, p_url, p_size, p_mime, auth.uid())
  returning id into did;
  return did;
end; $$;

create or replace function public.team_doc_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d record; my_role text;
begin
  select * into d from team_docs where id = p_id;
  if d is null then return jsonb_build_object('deleted', false); end if;
  select role into my_role from course_team_members where team_id = d.team_id and user_id = auth.uid();
  if d.uploaded_by <> auth.uid() and coalesce(my_role, '') not in ('po', 'sm') and not course_is_instructor(d.course_id) then
    raise exception 'Csak a feltöltő, a Product Owner, a Scrum Master vagy az oktató törölheti.';
  end if;
  delete from team_docs where id = p_id;
  return jsonb_build_object('deleted', true, 'path', d.storage_path);
end; $$;

create or replace function public.team_docs_list(p_team uuid)
returns table (id uuid, kind text, name text, note text, storage_path text, url text, size bigint,
               mime text, uploaded_by uuid, uploader text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not team_can_read(p_team) then raise exception 'Nincs hozzáférésed'; end if;
  return query
    select d.id, d.kind, d.name, d.note, d.storage_path, d.url, d.size, d.mime, d.uploaded_by, p.name, d.created_at
      from team_docs d left join profiles p on p.id = d.uploaded_by
     where d.team_id = p_team order by d.created_at desc;
end; $$;

-- ---- 4. órai pontok ----------------------------------------------------------
-- Alap: minden megválaszolt szavazás 1 pont, minden helyes kvízválasz +2 pont,
-- és minden alkalom, amin ott volt, 1 pont. Felülírható: courses.settings.points.
create or replace function public.course_points_cfg(cid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select settings->'points' from courses where id = cid),
                  '{"answer":1,"correct":2,"session":1}'::jsonb);
$$;
revoke all on function public.course_points_cfg(uuid) from public, anon;
grant execute on function public.course_points_cfg(uuid) to authenticated;

create or replace function public.course_points(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg jsonb; pa numeric; pc numeric; ps numeric; is_instr boolean; me_id uuid;
begin
  if not course_is_member(p_course) and not course_is_instructor(p_course) then
    raise exception 'Nem vagy a kurzus résztvevője';
  end if;
  cfg := course_points_cfg(p_course);
  pa := coalesce((cfg->>'answer')::numeric, 1);
  pc := coalesce((cfg->>'correct')::numeric, 2);
  ps := coalesce((cfg->>'session')::numeric, 1);
  is_instr := course_is_instructor(p_course);
  me_id := auth.uid();

  return (
    with per_user as (
      select e.user_id,
             (select count(*) from course_poll_answers a where a.course_id = p_course and a.user_id = e.user_id) as answers,
             (select count(*) from course_poll_answers a join course_poll_runs r on r.id = a.run_id
               where a.course_id = p_course and a.user_id = e.user_id
                 and r.correct is not null and (a.answer->>'choice') = (r.correct->>'choice')) as correct,
             (select count(*) from course_session_attendance s where s.course_id = p_course and s.user_id = e.user_id) as sessions
        from course_enrollments e
       where e.course_id = p_course and e.role = 'hallgato' and e.status = 'active'),
    scored as (
      select u.*, (u.answers * pa + u.correct * pc + u.sessions * ps) as points,
             m.team_id, t.name as team_name, p.name as user_name
        from per_user u
        left join course_team_members m on m.course_id = p_course and m.user_id = u.user_id
        left join course_teams t on t.id = m.team_id
        left join profiles p on p.id = u.user_id)
    select jsonb_build_object(
      'config', cfg,
      'me', (select to_jsonb(s) from scored s where s.user_id = me_id),
      'teams', coalesce((select jsonb_agg(x order by (x->>'points')::numeric desc) from (
          select jsonb_build_object('team_id', s.team_id, 'name', s.team_name,
                                    'members', count(*), 'points', sum(s.points),
                                    'answers', sum(s.answers), 'correct', sum(s.correct)) as x
            from scored s where s.team_id is not null
           group by s.team_id, s.team_name) q), '[]'::jsonb),
      -- egyéni sorokat csak az oktató lát; a hallgató a sajátját és a csapatok összesítését
      'users', case when is_instr then coalesce((select jsonb_agg(to_jsonb(s) order by s.points desc) from scored s), '[]'::jsonb)
                    else '[]'::jsonb end,
      'my_team', coalesce((select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'name', s.user_name,
                                                               'points', s.points, 'answers', s.answers, 'correct', s.correct)
                                            order by s.points desc)
                             from scored s
                            where s.team_id is not null
                              and s.team_id = (select m2.team_id from course_team_members m2
                                                where m2.course_id = p_course and m2.user_id = me_id)), '[]'::jsonb))
  );
end; $$;

-- ---- 5. áttekintő: dokumentum, üzenet, pont ---------------------------------
create or replace function public.course_teams_overview(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pts jsonb;
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  pts := course_points(p_course) -> 'teams';
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'team_id', t.id, 'name', t.name, 'status', t.status,
      'members', (select count(*) from course_team_members m where m.team_id = t.id),
      'sprints', (select count(*) from team_sprints s where s.team_id = t.id),
      'tasks', (select count(*) from team_tasks k where k.team_id = t.id),
      'done', (select count(*) from team_tasks k where k.team_id = t.id and k.status = 'done'),
      'doing', (select count(*) from team_tasks k where k.team_id = t.id and k.status in ('doing', 'review')),
      'overdue', (select count(*) from team_tasks k where k.team_id = t.id and k.status <> 'done'
                    and k.due_on is not null and k.due_on < current_date),
      'files', (select count(*) from team_task_files f where f.team_id = t.id),
      'docs', (select count(*) from team_docs d where d.team_id = t.id),
      'messages', (select count(*) from team_messages g where g.team_id = t.id),
      'dailies_7d', (select count(*) from team_events e where e.team_id = t.id and e.kind = 'daily' and e.day > current_date - 7),
      'retros', (select count(*) from team_events e where e.team_id = t.id and e.kind = 'retro'),
      'points', coalesce((select (x->>'points')::numeric from jsonb_array_elements(pts) x where (x->>'team_id')::uuid = t.id), 0),
      'inactive_members', (select count(*) from course_team_members m where m.team_id = t.id
                             and not exists (select 1 from team_tasks k where k.team_id = t.id and k.done_by = m.user_id)
                             and not exists (select 1 from team_task_files f where f.team_id = t.id and f.uploaded_by = m.user_id)
                             and not exists (select 1 from team_messages g where g.team_id = t.id and g.author = m.user_id)
                             and not exists (select 1 from team_events e where e.team_id = t.id and e.author = m.user_id)),
      'last_activity', greatest(
          (select max(k.done_at) from team_tasks k where k.team_id = t.id),
          (select max(f.created_at) from team_task_files f where f.team_id = t.id),
          (select max(d.created_at) from team_docs d where d.team_id = t.id),
          (select max(g.created_at) from team_messages g where g.team_id = t.id),
          (select max(e.updated_at) from team_events e where e.team_id = t.id)))
      order by t.name)
      from course_teams t where t.course_id = p_course), '[]'::jsonb);
end; $$;

-- ---- 6. munkatér-állapot: chat/doksi/pont számok + ki hány feladatot írt ki --
create or replace function public.team_room_extra(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not team_can_read(p_team) then raise exception 'Nincs hozzáférésed'; end if;
  select * into t from course_teams where id = p_team;
  return jsonb_build_object(
    'docs', (select count(*) from team_docs d where d.team_id = p_team),
    'messages', (select count(*) from team_messages g where g.team_id = p_team),
    'created_by', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', p.name,
                              'created', (select count(*) from team_tasks k where k.team_id = p_team and k.created_by = m.user_id),
                              'doing', (select count(*) from team_tasks k where k.team_id = p_team and k.assignee = m.user_id and k.status in ('doing','review')),
                              'todo', (select count(*) from team_tasks k where k.team_id = p_team and k.assignee = m.user_id and k.status = 'todo'),
                              'done', (select count(*) from team_tasks k where k.team_id = p_team and k.assignee = m.user_id and k.status = 'done'),
                              'messages', (select count(*) from team_messages g where g.team_id = p_team and g.author = m.user_id),
                              'docs', (select count(*) from team_docs d where d.team_id = p_team and d.uploaded_by = m.user_id))
                              order by p.name)
                     from course_team_members m join profiles p on p.id = m.user_id
                    where m.team_id = p_team), '[]'::jsonb),
    'points', (select course_points(t.course_id)));
end; $$;

-- ---- 7. jogosultságok --------------------------------------------------------
revoke all on function public.team_message_send(uuid, text, uuid, jsonb)          from public, anon;
revoke all on function public.team_message_delete(uuid)                           from public, anon;
revoke all on function public.team_messages_list(uuid, int)                       from public, anon;
revoke all on function public.team_message_to_task(uuid, text)                    from public, anon;
revoke all on function public.team_message_to_event(uuid, text, text)             from public, anon;
revoke all on function public.team_doc_add(uuid, text, text, text, text, text, bigint, text) from public, anon;
revoke all on function public.team_doc_delete(uuid)                               from public, anon;
revoke all on function public.team_docs_list(uuid)                                from public, anon;
revoke all on function public.course_points(uuid)                                 from public, anon;
revoke all on function public.team_room_extra(uuid)                               from public, anon;

grant execute on function
  public.team_message_send(uuid, text, uuid, jsonb), public.team_message_delete(uuid),
  public.team_messages_list(uuid, int), public.team_message_to_task(uuid, text),
  public.team_message_to_event(uuid, text, text),
  public.team_doc_add(uuid, text, text, text, text, text, bigint, text),
  public.team_doc_delete(uuid), public.team_docs_list(uuid),
  public.course_points(uuid), public.team_room_extra(uuid), public.team_can_write(uuid)
to authenticated;
