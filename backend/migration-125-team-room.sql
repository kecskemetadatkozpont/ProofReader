-- migration-125-team-room.sql
-- Csapat-munkatér: heti sprintek, Kanban-tábla, szertartások (planning / daily / retro),
-- bizonyíték-fájlok és aktivitás-kimutatás. Csak JÓVÁHAGYOTT csapat kap munkateret.
--
-- Döntések (felhasználó, 2026-09-17):
--   * Sprint: automatikus heti ritmus, hétfőtől vasárnapig. A sprintet nem kell megnyitni:
--     az aktuális heti sor a munkatér megnyitásakor jön létre (team_room_state).
--   * Szertartás: rövid, aszinkron űrlapok. Daily naponta egy bejegyzés / fő; planning és
--     retro sprintenként egy bejegyzés / fő.
--   * „Kész” állapothoz bizonyíték kell: legalább egy feltöltött fájl vagy link a feladaton.
--   * Az oktató mindent lát, de nem ír bele (kivéve, amit a 122/124 már enged: csapattagság,
--     szerepek, jóváhagyás).
--
-- Fájlok: a meglévő 'course-media' tárolóba, '<kurzus>/<feltöltő uid>/team/<feladat>/<fájl>'
-- útvonalon — így a 67-es migráció tárolási szabályai változatlanul érvényesek.
--
-- Előfeltétel: migration-122, 123, 124.
-- Ellenőrzés: select public.team_room_state('<team-uuid>');

-- ---- 1. táblák -------------------------------------------------------------
create table if not exists team_sprints (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references course_teams(id) on delete cascade,
  course_id  uuid not null references courses(id) on delete cascade,
  idx        int  not null,                               -- 1., 2., … sprint a csapatnál
  starts_on  date not null,
  ends_on    date not null,
  goal       text,                                        -- a sprint célja (planningen születik)
  created_at timestamptz not null default now(),
  unique (team_id, starts_on)
);
create index if not exists ts_team_idx on team_sprints(team_id, starts_on desc);

create table if not exists team_tasks (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references course_teams(id) on delete cascade,
  course_id  uuid not null references courses(id) on delete cascade,
  sprint_id  uuid references team_sprints(id) on delete set null,   -- null = backlog
  title      text not null,
  detail     text,
  status     text not null default 'todo' check (status in ('todo', 'doing', 'review', 'done')),
  assignee   uuid references profiles(id) on delete set null,
  estimate   int,                                         -- story point, szabadon
  due_on     date,
  ord        double precision not null default 0,         -- oszlopon belüli sorrend
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  done_at    timestamptz,
  done_by    uuid references profiles(id)
);
create index if not exists tt_team_idx   on team_tasks(team_id, status);
create index if not exists tt_sprint_idx on team_tasks(sprint_id);

create table if not exists team_task_files (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references team_tasks(id) on delete cascade,
  team_id      uuid not null references course_teams(id) on delete cascade,
  course_id    uuid not null references courses(id) on delete cascade,
  kind         text not null default 'file' check (kind in ('file', 'link')),
  name         text not null,
  storage_path text,                                      -- kind = 'file'
  url          text,                                      -- kind = 'link'
  size         bigint,
  mime         text,
  uploaded_by  uuid not null references profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists ttf_task_idx on team_task_files(task_id);
create index if not exists ttf_user_idx on team_task_files(team_id, uploaded_by);

create table if not exists team_events (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references course_teams(id) on delete cascade,
  course_id  uuid not null references courses(id) on delete cascade,
  sprint_id  uuid references team_sprints(id) on delete cascade,
  kind       text not null check (kind in ('planning', 'daily', 'retro')),
  day        date not null default current_date,
  author     uuid not null references profiles(id) on delete cascade,
  payload    jsonb not null default '{}'::jsonb,          -- daily {did,will,blocker} · retro {good,bad,action} · planning {note}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, kind, author, day)                     -- naponta (illetve sprintenként) egy bejegyzés / fő
);
create index if not exists te_team_idx on team_events(team_id, kind, day desc);

alter table team_sprints    enable row level security;
alter table team_tasks      enable row level security;
alter table team_task_files enable row level security;
alter table team_events     enable row level security;

-- ---- 2. ki láthatja a csapat munkaterét ------------------------------------
create or replace function public.team_can_read(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from course_team_members m where m.team_id = p_team and m.user_id = auth.uid())
      or exists (select 1 from course_teams t where t.id = p_team and course_is_instructor(t.course_id));
$$;
create or replace function public.team_can_write(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  -- az oktató OLVASÓ: belelát, de nem ír a csapat munkaterébe
  select exists (select 1 from course_team_members m where m.team_id = p_team and m.user_id = auth.uid());
$$;
revoke all on function public.team_can_read(uuid), public.team_can_write(uuid) from public, anon;
grant execute on function public.team_can_read(uuid), public.team_can_write(uuid) to authenticated;

drop policy if exists ts_read  on team_sprints;
create policy ts_read  on team_sprints    for select to authenticated using (team_can_read(team_id));
drop policy if exists tt_read  on team_tasks;
create policy tt_read  on team_tasks      for select to authenticated using (team_can_read(team_id));
drop policy if exists ttf_read on team_task_files;
create policy ttf_read on team_task_files for select to authenticated using (team_can_read(team_id));
drop policy if exists te_read  on team_events;
create policy te_read  on team_events     for select to authenticated using (team_can_read(team_id));
-- írás kizárólag az alábbi SECURITY DEFINER függvényeken át

-- ---- 3. munkatér állapota (egy hívás) --------------------------------------
-- Megnyitáskor létrehozza a hét sprintjét, ha még nincs. Csak jóváhagyott csapatnál.
create or replace function public.team_room_state(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; sp record; mon date; sun date; n int; can_write boolean;
begin
  if not team_can_read(p_team) then raise exception 'Nincs hozzáférésed ehhez a csapathoz'; end if;
  select * into t from course_teams where id = p_team;
  can_write := team_can_write(p_team);

  if t.status <> 'approved' then
    return jsonb_build_object('team', jsonb_build_object('id', t.id, 'name', t.name, 'status', t.status),
                              'pending', true, 'can_write', can_write);
  end if;

  mon := date_trunc('week', current_date)::date;          -- hétfő
  sun := mon + 6;
  select * into sp from team_sprints where team_id = p_team and starts_on = mon;
  if sp is null then
    select coalesce(max(idx), 0) + 1 into n from team_sprints where team_id = p_team;
    insert into team_sprints (team_id, course_id, idx, starts_on, ends_on)
      values (p_team, t.course_id, n, mon, sun)
      on conflict (team_id, starts_on) do nothing;
    select * into sp from team_sprints where team_id = p_team and starts_on = mon;
  end if;

  return jsonb_build_object(
    'team', jsonb_build_object('id', t.id, 'name', t.name, 'goal', t.goal, 'status', t.status, 'course_id', t.course_id),
    'can_write', can_write,
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', p.name, 'role', m.role,
                                                             'responsibility', m.responsibility)
                                          order by case m.role when 'po' then 0 when 'sm' then 1 else 2 end, p.name)
                           from course_team_members m join profiles p on p.id = m.user_id
                          where m.team_id = p_team), '[]'::jsonb),
    'sprint', to_jsonb(sp),
    'sprints', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'idx', s.idx, 'starts_on', s.starts_on,
                                                             'ends_on', s.ends_on, 'goal', s.goal) order by s.idx desc)
                           from team_sprints s where s.team_id = p_team), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', k.id, 'title', k.title, 'detail', k.detail, 'status', k.status,
                          'assignee', k.assignee, 'assignee_name', pa.name, 'estimate', k.estimate,
                          'due_on', k.due_on, 'ord', k.ord, 'sprint_id', k.sprint_id,
                          'created_by', k.created_by, 'done_at', k.done_at,
                          'files', coalesce((select jsonb_agg(jsonb_build_object(
                                        'id', f.id, 'kind', f.kind, 'name', f.name, 'url', f.url,
                                        'storage_path', f.storage_path, 'size', f.size,
                                        'uploaded_by', f.uploaded_by, 'uploader', pf.name, 'created_at', f.created_at)
                                        order by f.created_at)
                                      from team_task_files f left join profiles pf on pf.id = f.uploaded_by
                                     where f.task_id = k.id), '[]'::jsonb))
                        order by k.ord, k.created_at)
                         from team_tasks k left join profiles pa on pa.id = k.assignee
                        where k.team_id = p_team and (k.sprint_id = sp.id or k.sprint_id is null)), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'day', e.day,
                                                            'author', e.author, 'author_name', pe.name,
                                                            'payload', e.payload, 'updated_at', e.updated_at)
                                         order by e.day desc, pe.name)
                          from team_events e left join profiles pe on pe.id = e.author
                         where e.team_id = p_team and (e.sprint_id = sp.id or e.day >= sp.starts_on)), '[]'::jsonb),
    'stats', coalesce((select jsonb_agg(jsonb_build_object(
                          'user_id', m.user_id, 'name', p.name, 'role', m.role,
                          'assigned', (select count(*) from team_tasks k where k.team_id = p_team and k.assignee = m.user_id),
                          'done', (select count(*) from team_tasks k where k.team_id = p_team and k.assignee = m.user_id and k.status = 'done'),
                          'files', (select count(*) from team_task_files f where f.team_id = p_team and f.uploaded_by = m.user_id),
                          'dailies', (select count(*) from team_events e where e.team_id = p_team and e.kind = 'daily' and e.author = m.user_id),
                          'retros', (select count(*) from team_events e where e.team_id = p_team and e.kind = 'retro' and e.author = m.user_id),
                          'last_seen', greatest(
                              (select max(k.done_at) from team_tasks k where k.team_id = p_team and k.done_by = m.user_id),
                              (select max(f.created_at) from team_task_files f where f.team_id = p_team and f.uploaded_by = m.user_id),
                              (select max(e.updated_at) from team_events e where e.team_id = p_team and e.author = m.user_id)))
                          order by p.name)
                         from course_team_members m join profiles p on p.id = m.user_id
                        where m.team_id = p_team), '[]'::jsonb));
end; $$;

-- ---- 4. feladatok ----------------------------------------------------------
create or replace function public.team_task_save(p_team uuid, p_task jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; cid uuid; ttl text;
begin
  if not team_can_write(p_team) then raise exception 'Csak a csapat tagjai írhatnak ide'; end if;
  select course_id into cid from course_teams where id = p_team;
  ttl := btrim(coalesce(p_task->>'title', ''));
  if length(ttl) < 2 then raise exception 'A feladatnak legyen címe.'; end if;
  tid := nullif(p_task->>'id', '')::uuid;
  if tid is null then
    insert into team_tasks (team_id, course_id, sprint_id, title, detail, assignee, estimate, due_on, ord, created_by)
    values (p_team, cid, nullif(p_task->>'sprint_id', '')::uuid, left(ttl, 200),
            nullif(btrim(coalesce(p_task->>'detail', '')), ''), nullif(p_task->>'assignee', '')::uuid,
            nullif(p_task->>'estimate', '')::int, nullif(p_task->>'due_on', '')::date,
            coalesce(nullif(p_task->>'ord', '')::double precision, extract(epoch from now())), auth.uid())
    returning id into tid;
  else
    if not exists (select 1 from team_tasks where id = tid and team_id = p_team) then
      raise exception 'Ez a feladat nem ehhez a csapathoz tartozik.';
    end if;
    update team_tasks set
      title = left(ttl, 200),
      detail = nullif(btrim(coalesce(p_task->>'detail', '')), ''),
      assignee = nullif(p_task->>'assignee', '')::uuid,
      estimate = nullif(p_task->>'estimate', '')::int,
      due_on = nullif(p_task->>'due_on', '')::date,
      sprint_id = case when p_task ? 'sprint_id' then nullif(p_task->>'sprint_id', '')::uuid else sprint_id end
     where id = tid;
  end if;
  return tid;
end; $$;

-- „Kész” állapothoz bizonyíték kell: legalább egy fájl vagy link a feladaton.
create or replace function public.team_task_status(p_task uuid, p_status text, p_ord double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k record; ev int;
begin
  select * into k from team_tasks where id = p_task;
  if k is null then raise exception 'Nincs ilyen feladat'; end if;
  if not team_can_write(k.team_id) then raise exception 'Csak a csapat tagjai írhatnak ide'; end if;
  if p_status not in ('todo', 'doing', 'review', 'done') then raise exception 'Ismeretlen állapot'; end if;
  if p_status = 'done' then
    select count(*) into ev from team_task_files where task_id = p_task;
    if ev = 0 then
      raise exception 'Késznek jelöléshez tölts fel bizonyítékot (fájlt vagy linket) a feladathoz.';
    end if;
  end if;
  update team_tasks
     set status = p_status,
         ord = coalesce(p_ord, ord),
         done_at = case when p_status = 'done' then coalesce(done_at, now()) else null end,
         done_by = case when p_status = 'done' then coalesce(done_by, auth.uid()) else null end
   where id = p_task;
  return jsonb_build_object('id', p_task, 'status', p_status);
end; $$;

create or replace function public.team_task_delete(p_task uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k record;
begin
  select * into k from team_tasks where id = p_task;
  if k is null then return; end if;
  if not team_can_write(k.team_id) then raise exception 'Csak a csapat tagjai törölhetnek'; end if;
  delete from team_tasks where id = p_task;
end; $$;

-- ---- 5. bizonyítékok -------------------------------------------------------
-- A fájl feltöltése a kliensből megy a course-media tárolóba; ez a sor a nyoma:
-- ki, mikor, mit tett hozzá. Ez adja a „ki végezte el a feladatát” bizonyítékot.
create or replace function public.team_file_add(p_task uuid, p_kind text, p_name text,
  p_path text default null, p_url text default null, p_size bigint default null, p_mime text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare k record; fid uuid;
begin
  select * into k from team_tasks where id = p_task;
  if k is null then raise exception 'Nincs ilyen feladat'; end if;
  if not team_can_write(k.team_id) then raise exception 'Csak a csapat tagjai tölthetnek fel'; end if;
  if p_kind not in ('file', 'link') then raise exception 'Ismeretlen típus'; end if;
  if p_kind = 'file' and coalesce(p_path, '') = '' then raise exception 'Hiányzik a fájl útvonala'; end if;
  if p_kind = 'link' and coalesce(p_url, '') !~ '^https?://' then raise exception 'A link http(s) címmel kezdődjön.'; end if;
  insert into team_task_files (task_id, team_id, course_id, kind, name, storage_path, url, size, mime, uploaded_by)
  values (p_task, k.team_id, k.course_id, p_kind, left(btrim(coalesce(p_name, 'bizonyíték')), 200),
          p_path, p_url, p_size, p_mime, auth.uid())
  returning id into fid;
  return fid;
end; $$;

-- Törölni a feltöltő vagy a Scrum Master / PO tud (a tévesen feltöltött fájl miatt).
create or replace function public.team_file_delete(p_file uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f record; my_role text;
begin
  select * into f from team_task_files where id = p_file;
  if f is null then return jsonb_build_object('deleted', false); end if;
  select role into my_role from course_team_members where team_id = f.team_id and user_id = auth.uid();
  if f.uploaded_by <> auth.uid() and coalesce(my_role, '') not in ('po', 'sm') then
    raise exception 'Csak a feltöltő, a Product Owner vagy a Scrum Master törölheti.';
  end if;
  delete from team_task_files where id = p_file;
  -- bizonyíték nélkül a feladat nem maradhat késznek
  update team_tasks set status = 'review', done_at = null, done_by = null
   where id = f.task_id and status = 'done'
     and not exists (select 1 from team_task_files x where x.task_id = f.task_id);
  return jsonb_build_object('deleted', true, 'path', f.storage_path);
end; $$;

-- ---- 6. szertartások -------------------------------------------------------
create or replace function public.team_event_save(p_team uuid, p_kind text, p_payload jsonb, p_day date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; sid uuid; d date; eid uuid;
begin
  if not team_can_write(p_team) then raise exception 'Csak a csapat tagjai írhatnak ide'; end if;
  if p_kind not in ('planning', 'daily', 'retro') then raise exception 'Ismeretlen szertartás'; end if;
  select course_id into cid from course_teams where id = p_team;
  select id into sid from team_sprints where team_id = p_team and current_date between starts_on and ends_on;
  -- planning és retro sprintenként egy bejegyzés / fő: a sprint kezdő-, illetve zárónapjára könyveljük
  d := case p_kind
         when 'daily' then coalesce(p_day, current_date)
         when 'planning' then coalesce((select starts_on from team_sprints where id = sid), current_date)
         else coalesce((select ends_on from team_sprints where id = sid), current_date) end;
  insert into team_events (team_id, course_id, sprint_id, kind, day, author, payload)
  values (p_team, cid, sid, p_kind, d, auth.uid(), coalesce(p_payload, '{}'::jsonb))
  on conflict (team_id, kind, author, day) do update
    set payload = excluded.payload, updated_at = now(), sprint_id = excluded.sprint_id
  returning id into eid;
  return eid;
end; $$;

create or replace function public.team_sprint_goal(p_sprint uuid, p_goal text) returns void
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from team_sprints where id = p_sprint;
  if s is null then raise exception 'Nincs ilyen sprint'; end if;
  if not team_can_write(s.team_id) then raise exception 'Csak a csapat tagjai írhatnak ide'; end if;
  update team_sprints set goal = nullif(left(btrim(coalesce(p_goal, '')), 300), '') where id = p_sprint;
end; $$;

-- ---- 7. oktatói áttekintés -------------------------------------------------
-- Kurzus szintű kimutatás: csapatonként haladás és aktivitás, egy lekérdezésben.
create or replace function public.course_teams_overview(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'team_id', t.id, 'name', t.name, 'status', t.status,
      'members', (select count(*) from course_team_members m where m.team_id = t.id),
      'sprints', (select count(*) from team_sprints s where s.team_id = t.id),
      'tasks', (select count(*) from team_tasks k where k.team_id = t.id),
      'done', (select count(*) from team_tasks k where k.team_id = t.id and k.status = 'done'),
      'doing', (select count(*) from team_tasks k where k.team_id = t.id and k.status in ('doing', 'review')),
      'files', (select count(*) from team_task_files f where f.team_id = t.id),
      'dailies_7d', (select count(*) from team_events e where e.team_id = t.id and e.kind = 'daily' and e.day > current_date - 7),
      'retros', (select count(*) from team_events e where e.team_id = t.id and e.kind = 'retro'),
      'inactive_members', (select count(*) from course_team_members m where m.team_id = t.id
                             and not exists (select 1 from team_tasks k where k.team_id = t.id and k.done_by = m.user_id)
                             and not exists (select 1 from team_task_files f where f.team_id = t.id and f.uploaded_by = m.user_id)
                             and not exists (select 1 from team_events e where e.team_id = t.id and e.author = m.user_id)),
      'last_activity', greatest(
          (select max(k.done_at) from team_tasks k where k.team_id = t.id),
          (select max(f.created_at) from team_task_files f where f.team_id = t.id),
          (select max(e.updated_at) from team_events e where e.team_id = t.id)))
      order by t.name)
      from course_teams t where t.course_id = p_course), '[]'::jsonb);
end; $$;

-- ---- 8. jogosultságok ------------------------------------------------------
revoke all on function public.team_room_state(uuid)                                     from public, anon;
revoke all on function public.team_task_save(uuid, jsonb)                               from public, anon;
revoke all on function public.team_task_status(uuid, text, double precision)            from public, anon;
revoke all on function public.team_task_delete(uuid)                                    from public, anon;
revoke all on function public.team_file_add(uuid, text, text, text, text, bigint, text) from public, anon;
revoke all on function public.team_file_delete(uuid)                                    from public, anon;
revoke all on function public.team_event_save(uuid, text, jsonb, date)                  from public, anon;
revoke all on function public.team_sprint_goal(uuid, text)                              from public, anon;
revoke all on function public.course_teams_overview(uuid)                               from public, anon;

grant execute on function
  public.team_room_state(uuid), public.team_task_save(uuid, jsonb),
  public.team_task_status(uuid, text, double precision), public.team_task_delete(uuid),
  public.team_file_add(uuid, text, text, text, text, bigint, text), public.team_file_delete(uuid),
  public.team_event_save(uuid, text, jsonb, date), public.team_sprint_goal(uuid, text),
  public.course_teams_overview(uuid)
to authenticated;
