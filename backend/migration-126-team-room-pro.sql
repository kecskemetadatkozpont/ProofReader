-- migration-126-team-room-pro.sql
-- A csapat-munkatér bővítése: prioritás, címkék, részfeladatok, hozzászólások,
-- és a kártyák sorrendje (húzd-és-ejtsd).
--
-- Előfeltétel: migration-125.
-- Ellenőrzés:
--   select column_name from information_schema.columns
--    where table_name = 'team_tasks' and column_name in ('priority','tags','checklist');   -- 3 sor
--   select count(*) from information_schema.tables where table_name = 'team_task_comments'; -- 1

alter table team_tasks add column if not exists priority  text not null default 'normal';
alter table team_tasks add column if not exists tags      text[] not null default '{}';
alter table team_tasks add column if not exists checklist jsonb  not null default '[]'::jsonb;
do $$ begin
  alter table team_tasks add constraint tt_priority_chk check (priority in ('low', 'normal', 'high', 'urgent'));
exception when duplicate_object then null; end $$;

create table if not exists team_task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references team_tasks(id) on delete cascade,
  team_id    uuid not null references course_teams(id) on delete cascade,
  course_id  uuid not null references courses(id) on delete cascade,
  author     uuid not null references profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists ttc_task_idx on team_task_comments(task_id, created_at);
alter table team_task_comments enable row level security;
drop policy if exists ttc_read on team_task_comments;
create policy ttc_read on team_task_comments for select to authenticated using (team_can_read(team_id));

-- ---- feladat mentése az új mezőkkel ---------------------------------------
create or replace function public.team_task_save(p_team uuid, p_task jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; cid uuid; ttl text; pri text; tg text[]; chk jsonb;
begin
  if not team_can_write(p_team) then raise exception 'Csak a csapat tagjai írhatnak ide'; end if;
  select course_id into cid from course_teams where id = p_team;
  ttl := btrim(coalesce(p_task->>'title', ''));
  if length(ttl) < 2 then raise exception 'A feladatnak legyen címe.'; end if;
  pri := coalesce(nullif(p_task->>'priority', ''), 'normal');
  if pri not in ('low', 'normal', 'high', 'urgent') then pri := 'normal'; end if;
  -- címkék: legfeljebb 6, egyenként 24 karakter, kisbetűsítve
  tg := coalesce((select array_agg(distinct left(lower(btrim(x)), 24))
                    from jsonb_array_elements_text(coalesce(p_task->'tags', '[]'::jsonb)) as t(x)
                   where btrim(x) <> ''), '{}');
  if array_length(tg, 1) > 6 then tg := tg[1:6]; end if;
  chk := case when jsonb_typeof(p_task->'checklist') = 'array' then p_task->'checklist' else null end;

  tid := nullif(p_task->>'id', '')::uuid;
  if tid is null then
    insert into team_tasks (team_id, course_id, sprint_id, title, detail, assignee, estimate, due_on, ord,
                            priority, tags, checklist, created_by)
    values (p_team, cid, nullif(p_task->>'sprint_id', '')::uuid, left(ttl, 200),
            nullif(btrim(coalesce(p_task->>'detail', '')), ''), nullif(p_task->>'assignee', '')::uuid,
            nullif(p_task->>'estimate', '')::int, nullif(p_task->>'due_on', '')::date,
            coalesce(nullif(p_task->>'ord', '')::double precision, extract(epoch from now())),
            pri, tg, coalesce(chk, '[]'::jsonb), auth.uid())
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
      priority = pri,
      tags = tg,
      checklist = coalesce(chk, checklist),
      sprint_id = case when p_task ? 'sprint_id' then nullif(p_task->>'sprint_id', '')::uuid else sprint_id end
     where id = tid;
  end if;
  return tid;
end; $$;

-- ---- részfeladat pipálása (gyors út, a teljes mentés nélkül) ---------------
create or replace function public.team_task_check(p_task uuid, p_index int, p_done boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k record; arr jsonb; item jsonb;
begin
  select * into k from team_tasks where id = p_task;
  if k is null then raise exception 'Nincs ilyen feladat'; end if;
  if not team_can_write(k.team_id) then raise exception 'Csak a csapat tagjai írhatnak ide'; end if;
  arr := k.checklist;
  if p_index < 0 or p_index >= jsonb_array_length(arr) then raise exception 'Nincs ilyen részfeladat'; end if;
  item := (arr -> p_index) || jsonb_build_object('done', coalesce(p_done, false));
  update team_tasks set checklist = jsonb_set(arr, array[p_index::text], item) where id = p_task;
  return item;
end; $$;

-- ---- hozzászólások ---------------------------------------------------------
create or replace function public.team_comment_add(p_task uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare k record; cid uuid; body text;
begin
  select * into k from team_tasks where id = p_task;
  if k is null then raise exception 'Nincs ilyen feladat'; end if;
  if not team_can_write(k.team_id) then raise exception 'Csak a csapat tagjai szólhatnak hozzá'; end if;
  body := btrim(coalesce(p_body, ''));
  if body = '' then raise exception 'Üres hozzászólás.'; end if;
  insert into team_task_comments (task_id, team_id, course_id, author, body)
  values (p_task, k.team_id, k.course_id, auth.uid(), left(body, 2000))
  returning id into cid;
  return cid;
end; $$;

create or replace function public.team_comment_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c record; my_role text;
begin
  select * into c from team_task_comments where id = p_id;
  if c is null then return; end if;
  select role into my_role from course_team_members where team_id = c.team_id and user_id = auth.uid();
  if c.author <> auth.uid() and coalesce(my_role, '') not in ('po', 'sm') then
    raise exception 'Csak a szerzője, a Product Owner vagy a Scrum Master törölheti.';
  end if;
  delete from team_task_comments where id = p_id;
end; $$;

create or replace function public.team_task_comments_list(p_task uuid)
returns table (id uuid, author uuid, author_name text, body text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare k record;
begin
  select * into k from team_tasks where id = p_task;
  if k is null or not team_can_read(k.team_id) then raise exception 'Nincs hozzáférésed'; end if;
  return query
    select c.id, c.author, p.name, c.body, c.created_at
      from team_task_comments c left join profiles p on p.id = c.author
     where c.task_id = p_task order by c.created_at;
end; $$;

-- ---- állapot: az új mezőkkel és a hozzászólás-számmal ----------------------
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

  mon := date_trunc('week', current_date)::date;
  sun := mon + 6;
  select * into sp from team_sprints where team_id = p_team and starts_on = mon;
  if sp is null then
    select coalesce(max(idx), 0) + 1 into n from team_sprints where team_id = p_team;
    insert into team_sprints (team_id, course_id, idx, starts_on, ends_on)
      values (p_team, t.course_id, n, mon, sun) on conflict (team_id, starts_on) do nothing;
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
                          'priority', k.priority, 'tags', to_jsonb(k.tags), 'checklist', k.checklist,
                          'created_by', k.created_by, 'done_at', k.done_at,
                          'comments', (select count(*) from team_task_comments c where c.task_id = k.id),
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
                          'comments', (select count(*) from team_task_comments c where c.team_id = p_team and c.author = m.user_id),
                          'dailies', (select count(*) from team_events e where e.team_id = p_team and e.kind = 'daily' and e.author = m.user_id),
                          'retros', (select count(*) from team_events e where e.team_id = p_team and e.kind = 'retro' and e.author = m.user_id),
                          'last_seen', greatest(
                              (select max(k.done_at) from team_tasks k where k.team_id = p_team and k.done_by = m.user_id),
                              (select max(f.created_at) from team_task_files f where f.team_id = p_team and f.uploaded_by = m.user_id),
                              (select max(c.created_at) from team_task_comments c where c.team_id = p_team and c.author = m.user_id),
                              (select max(e.updated_at) from team_events e where e.team_id = p_team and e.author = m.user_id)))
                          order by p.name)
                         from course_team_members m join profiles p on p.id = m.user_id
                        where m.team_id = p_team), '[]'::jsonb));
end; $$;

revoke all on function public.team_task_check(uuid, int, boolean)     from public, anon;
revoke all on function public.team_comment_add(uuid, text)            from public, anon;
revoke all on function public.team_comment_delete(uuid)               from public, anon;
revoke all on function public.team_task_comments_list(uuid)           from public, anon;
grant execute on function public.team_task_check(uuid, int, boolean), public.team_comment_add(uuid, text),
  public.team_comment_delete(uuid), public.team_task_comments_list(uuid),
  public.team_task_save(uuid, jsonb), public.team_room_state(uuid) to authenticated;
