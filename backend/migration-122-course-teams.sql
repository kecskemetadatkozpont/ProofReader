-- migration-122-course-teams.sql
-- Önszerveződő Scrum-csapatok a kurzuson belül.
--
-- Modell: a hallgató csapatot alapít (név + cél), a többiek a szabad helyekre belépnek.
-- Egy hallgató egy kurzuson egy csapatban lehet. Szerepek: Product Owner (po),
-- Scrum Master (sm), fejlesztő (dev) — csapatonként legfeljebb egy PO és egy SM.
-- A létszámhatárt, a csapatalakítási határidőt és a zárolást az oktató állítja
-- (courses.settings.teams = {"min":3,"max":6,"deadline":"2026-10-05","locked":false}).
--
-- Miért RPC-ken át: a méretkorlát, az „egy csapat / hallgató”, a szerep-egyediség és a
-- határidő egyszerre több sorra vonatkozó szabály — RLS-ből ezek nem kényszeríthetők ki.
-- Olvasni viszont mindenki lát mindent a kurzuson belül: a csapatszervezéshez ez kell.
--
-- Előfeltétel: migration-66 (courses, course_role/course_is_member), 118 (névsor, zárolás).
-- Ellenőrzés: select public.course_teams_state('<course-uuid>');

create table if not exists course_teams (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references courses(id) on delete cascade,
  name       text not null,
  goal       text,                                  -- egy mondat: mivel foglalkozik a csapat
  locked     boolean not null default false,        -- oktató zárolta: nem lehet be/kilépni
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists ct_course_name_idx on course_teams(course_id, lower(name));
create index if not exists ct_course_idx on course_teams(course_id);

create table if not exists course_team_members (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references course_teams(id) on delete cascade,
  course_id      uuid not null references courses(id) on delete cascade,
  user_id        uuid not null references profiles(id) on delete cascade,
  role           text not null default 'dev' check (role in ('po', 'sm', 'dev')),
  responsibility text,                              -- amit magára vállal, saját szavaival
  joined_at      timestamptz not null default now(),
  unique (course_id, user_id)                       -- egy kurzuson egy csapat
);
create index if not exists ctm_team_idx on course_team_members(team_id);
-- csapatonként legfeljebb egy PO és egy SM
create unique index if not exists ctm_one_po_idx on course_team_members(team_id) where role = 'po';
create unique index if not exists ctm_one_sm_idx on course_team_members(team_id) where role = 'sm';

alter table course_teams        enable row level security;
alter table course_team_members enable row level security;

drop policy if exists ct_read on course_teams;
create policy ct_read on course_teams for select to authenticated using (course_is_member(course_id));
drop policy if exists ctm_read on course_team_members;
create policy ctm_read on course_team_members for select to authenticated using (course_is_member(course_id));
-- írás kizárólag az alábbi SECURITY DEFINER függvényeken át

-- ---- beállítások -----------------------------------------------------------
create or replace function public.course_team_cfg(cid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select settings->'teams' from courses where id = cid), '{}'::jsonb)
      || case when (select settings->'teams' from courses where id = cid) is null
              then '{"min":3,"max":6,"locked":false}'::jsonb else '{}'::jsonb end;
$$;
revoke all on function public.course_team_cfg(uuid) from public, anon;
grant execute on function public.course_team_cfg(uuid) to authenticated;

-- Csapatalakítás nyitva van-e: az oktató zárolása és a határidő dönti el.
create or replace function public.course_teams_open(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not coalesce((course_team_cfg(cid)->>'locked')::boolean, false)
     and coalesce((course_team_cfg(cid)->>'deadline')::date >= current_date, true);
$$;
revoke all on function public.course_teams_open(uuid) from public, anon;
grant execute on function public.course_teams_open(uuid) to authenticated;

create or replace function public.teams_guard(cid uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if course_is_instructor(cid) then return; end if;                  -- az oktatóra a határidő nem vonatkozik
  if course_role(cid) is null then raise exception 'Nem vagy a kurzus résztvevője'; end if;
  if not course_teams_open(cid) then
    raise exception 'A csapatalakítás lezárult — szólj az oktatónak.';
  end if;
end; $$;
revoke all on function public.teams_guard(uuid) from public, anon;

-- ---- csapat alapítása ------------------------------------------------------
create or replace function public.course_team_create(p_course uuid, p_name text, p_goal text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; nm text;
begin
  perform teams_guard(p_course);
  nm := btrim(coalesce(p_name, ''));
  if length(nm) < 2 then raise exception 'A csapatnév legalább 2 karakter.'; end if;
  if length(nm) > 60 then nm := left(nm, 60); end if;
  if exists (select 1 from course_teams where course_id = p_course and lower(name) = lower(nm)) then
    raise exception 'Ilyen nevű csapat már van — válassz másikat.';
  end if;
  if exists (select 1 from course_team_members where course_id = p_course and user_id = auth.uid()) then
    raise exception 'Már tagja vagy egy csapatnak — előbb lépj ki belőle.';
  end if;
  insert into course_teams (course_id, name, goal, created_by)
    values (p_course, nm, nullif(btrim(coalesce(p_goal, '')), ''), auth.uid())
    returning id into tid;
  insert into course_team_members (team_id, course_id, user_id, role) values (tid, p_course, auth.uid(), 'dev');
  return tid;
end; $$;

-- ---- csatlakozás / kilépés -------------------------------------------------
create or replace function public.course_team_join(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; cnt int; mx int;
begin
  select * into t from course_teams where id = p_team;
  if t is null then raise exception 'Nincs ilyen csapat'; end if;
  perform teams_guard(t.course_id);
  if t.locked then raise exception 'Ez a csapat zárolva van.'; end if;
  if exists (select 1 from course_team_members where course_id = t.course_id and user_id = auth.uid()) then
    raise exception 'Már tagja vagy egy csapatnak — előbb lépj ki belőle.';
  end if;
  select count(*) into cnt from course_team_members where team_id = p_team;
  mx := coalesce((course_team_cfg(t.course_id)->>'max')::int, 6);
  if cnt >= mx then raise exception 'Ez a csapat betelt (% fő).', mx; end if;
  insert into course_team_members (team_id, course_id, user_id, role) values (p_team, t.course_id, auth.uid(), 'dev');
  return jsonb_build_object('team', p_team, 'size', cnt + 1);
end; $$;

-- Kilépés a saját csapatból. Az utolsó tag távozásakor a csapat megszűnik.
create or replace function public.course_team_leave(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid; left_cnt int;
begin
  perform teams_guard(p_course);
  select team_id into tid from course_team_members where course_id = p_course and user_id = auth.uid();
  if tid is null then raise exception 'Nem vagy csapattag.'; end if;
  if exists (select 1 from course_teams where id = tid and locked) then
    raise exception 'A csapat zárolva van — szólj az oktatónak.';
  end if;
  delete from course_team_members where team_id = tid and user_id = auth.uid();
  select count(*) into left_cnt from course_team_members where team_id = tid;
  if left_cnt = 0 then delete from course_teams where id = tid; end if;
  return jsonb_build_object('left', tid, 'remaining', left_cnt);
end; $$;

-- ---- szerepek és felelősségek ---------------------------------------------
-- A csapat maga osztja el a szerepeket: bármelyik tag átállíthatja a sajátját és
-- a csapattársáét is (szóban megbeszélik), de PO-ból és SM-ből csak egy lehet.
create or replace function public.course_team_set_role(p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m record; me_team uuid; taken text;
begin
  if p_role not in ('po', 'sm', 'dev') then raise exception 'Ismeretlen szerep'; end if;
  select * into m from course_team_members where user_id = p_user;
  if m is null then raise exception 'Ez a hallgató nem csapattag.'; end if;
  select team_id into me_team from course_team_members where course_id = m.course_id and user_id = auth.uid();
  if me_team is distinct from m.team_id and not course_is_instructor(m.course_id) then
    raise exception 'Csak a saját csapatodban oszthattok szerepet.';
  end if;
  perform teams_guard(m.course_id);
  if p_role in ('po', 'sm') then
    select p.name into taken from course_team_members x join profiles p on p.id = x.user_id
     where x.team_id = m.team_id and x.role = p_role and x.user_id <> p_user;
    if taken is not null then
      raise exception '% már % — előbb neki le kell adnia.', taken,
        case p_role when 'po' then 'Product Owner' else 'Scrum Master' end;
    end if;
  end if;
  update course_team_members set role = p_role where user_id = p_user;
  return jsonb_build_object('user', p_user, 'role', p_role);
end; $$;

create or replace function public.course_team_set_responsibility(p_course uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update course_team_members set responsibility = nullif(left(btrim(coalesce(p_text, '')), 200), '')
   where course_id = p_course and user_id = auth.uid();
  if not found then raise exception 'Nem vagy csapattag.'; end if;
end; $$;

create or replace function public.course_team_update(p_team uuid, p_name text, p_goal text) returns void
language plpgsql security definer set search_path = public as $$
declare t record; nm text;
begin
  select * into t from course_teams where id = p_team;
  if t is null then raise exception 'Nincs ilyen csapat'; end if;
  if not course_is_instructor(t.course_id)
     and not exists (select 1 from course_team_members where team_id = p_team and user_id = auth.uid()) then
    raise exception 'Csak a csapat tagjai írhatják át.';
  end if;
  perform teams_guard(t.course_id);
  nm := left(btrim(coalesce(p_name, '')), 60);
  if length(nm) < 2 then raise exception 'A csapatnév legalább 2 karakter.'; end if;
  if exists (select 1 from course_teams where course_id = t.course_id and lower(name) = lower(nm) and id <> p_team) then
    raise exception 'Ilyen nevű csapat már van.';
  end if;
  update course_teams set name = nm, goal = nullif(left(btrim(coalesce(p_goal, '')), 200), '') where id = p_team;
end; $$;

-- ---- áttekintés ------------------------------------------------------------
-- Egy hívás: beállítások + csapatok tagokkal + a csapat nélküli hallgatók.
-- (474 fős kurzuson is egy kérés, a kliens ebből rajzol mindent.)
create or replace function public.course_teams_state(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg jsonb; teams jsonb; solo jsonb; me jsonb;
begin
  if not course_is_member(p_course) and not course_is_instructor(p_course) then
    raise exception 'Nem vagy a kurzus résztvevője';
  end if;
  cfg := course_team_cfg(p_course);
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into teams from (
    select jsonb_build_object(
      'id', t.id, 'name', t.name, 'goal', t.goal, 'locked', t.locked,
      'members', coalesce((
        select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', p.name, 'role', m.role,
                                            'responsibility', m.responsibility, 'joined_at', m.joined_at)
                          order by case m.role when 'po' then 0 when 'sm' then 1 else 2 end, p.name)
          from course_team_members m join profiles p on p.id = m.user_id
         where m.team_id = t.id), '[]'::jsonb)) as x
      from course_teams t where t.course_id = p_course) s;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', e.user_id, 'name', p.name) order by p.name), '[]'::jsonb)
    into solo
    from course_enrollments e join profiles p on p.id = e.user_id
   where e.course_id = p_course and e.role = 'hallgato' and e.status = 'active'
     and not exists (select 1 from course_team_members m where m.course_id = p_course and m.user_id = e.user_id);
  select to_jsonb(x) into me from (
    select m.team_id, m.role, m.responsibility from course_team_members m
     where m.course_id = p_course and m.user_id = auth.uid()) x;
  return jsonb_build_object('config', cfg, 'open', course_teams_open(p_course),
                            'teams', teams, 'solo', solo, 'me', me,
                            'is_instructor', course_is_instructor(p_course));
end; $$;

-- ---- oktatói műveletek -----------------------------------------------------
create or replace function public.course_teams_config(p_course uuid, p_cfg jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur jsonb; nxt jsonb; mn int; mx int;
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  mn := coalesce((p_cfg->>'min')::int, 3); mx := coalesce((p_cfg->>'max')::int, 6);
  if mn < 1 or mx < mn or mx > 20 then raise exception 'A létszámhatár 1 és 20 között legyen, és a minimum ne legyen nagyobb a maximumnál.'; end if;
  select settings into cur from courses where id = p_course;
  nxt := jsonb_build_object('min', mn, 'max', mx,
                            'locked', coalesce((p_cfg->>'locked')::boolean, false),
                            'deadline', nullif(p_cfg->>'deadline', ''));
  update courses set settings = coalesce(cur, '{}'::jsonb) || jsonb_build_object('teams', nxt) where id = p_course;
  return nxt;
end; $$;

-- Hallgató áthelyezése vagy kivétele (p_team = null → kikerül a csapatból).
create or replace function public.course_team_move(p_course uuid, p_user uuid, p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cnt int; mx int; old_team uuid;
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  select team_id into old_team from course_team_members where course_id = p_course and user_id = p_user;
  delete from course_team_members where course_id = p_course and user_id = p_user;
  if old_team is not null and not exists (select 1 from course_team_members where team_id = old_team) then
    delete from course_teams where id = old_team;
  end if;
  if p_team is null then return; end if;
  select count(*) into cnt from course_team_members where team_id = p_team;
  mx := coalesce((course_team_cfg(p_course)->>'max')::int, 6);
  if cnt >= mx then raise exception 'Ez a csapat betelt (% fő).', mx; end if;
  insert into course_team_members (team_id, course_id, user_id, role) values (p_team, p_course, p_user, 'dev');
end; $$;

create or replace function public.course_team_delete(p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select course_id into cid from course_teams where id = p_team;
  if cid is null or not course_is_instructor(cid) then raise exception 'Nincs jogosultság'; end if;
  delete from course_teams where id = p_team;   -- a tagság cascade-del törlődik
end; $$;

create or replace function public.course_team_lock(p_team uuid, p_locked boolean) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select course_id into cid from course_teams where id = p_team;
  if cid is null or not course_is_instructor(cid) then raise exception 'Nincs jogosultság'; end if;
  update course_teams set locked = coalesce(p_locked, false) where id = p_team;
end; $$;

-- A maradék hallgatók elosztása: előbb a minimum alatti csapatokat tölti fel,
-- utána új csapatokat nyit („Csapat 12” néven). Determinisztikus, névsor szerint.
create or replace function public.course_teams_autofill(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mn int; mx int; u record; tgt uuid; n int := 0; made int := 0; idx int;
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  mn := coalesce((course_team_cfg(p_course)->>'min')::int, 3);
  mx := coalesce((course_team_cfg(p_course)->>'max')::int, 6);
  for u in
    select e.user_id from course_enrollments e join profiles p on p.id = e.user_id
     where e.course_id = p_course and e.role = 'hallgato' and e.status = 'active'
       and not exists (select 1 from course_team_members m where m.course_id = p_course and m.user_id = e.user_id)
     order by p.name
  loop
    select t.id into tgt from course_teams t
      left join course_team_members m on m.team_id = t.id
     where t.course_id = p_course and not t.locked
     group by t.id having count(m.id) < mn
     order by count(m.id) desc limit 1;               -- a majdnem teljes csapatokat tölti előbb
    if tgt is null then
      select t.id into tgt from course_teams t
        left join course_team_members m on m.team_id = t.id
       where t.course_id = p_course and not t.locked
       group by t.id having count(m.id) < mx
       order by count(m.id) asc limit 1;              -- utána a legkisebb, még nem teli csapat
    end if;
    if tgt is null then
      select coalesce(count(*), 0) + 1 into idx from course_teams where course_id = p_course;
      insert into course_teams (course_id, name, created_by) values (p_course, 'Csapat ' || idx, auth.uid())
        returning id into tgt;
      made := made + 1;
    end if;
    insert into course_team_members (team_id, course_id, user_id) values (tgt, p_course, u.user_id);
    n := n + 1;
  end loop;
  return jsonb_build_object('placed', n, 'new_teams', made);
end; $$;

-- ---- jogosultságok ---------------------------------------------------------
revoke all on function public.course_team_create(uuid, text, text)            from public, anon;
revoke all on function public.course_team_join(uuid)                          from public, anon;
revoke all on function public.course_team_leave(uuid)                         from public, anon;
revoke all on function public.course_team_set_role(uuid, text)                from public, anon;
revoke all on function public.course_team_set_responsibility(uuid, text)      from public, anon;
revoke all on function public.course_team_update(uuid, text, text)            from public, anon;
revoke all on function public.course_teams_state(uuid)                        from public, anon;
revoke all on function public.course_teams_config(uuid, jsonb)                from public, anon;
revoke all on function public.course_team_move(uuid, uuid, uuid)              from public, anon;
revoke all on function public.course_team_delete(uuid)                        from public, anon;
revoke all on function public.course_team_lock(uuid, boolean)                 from public, anon;
revoke all on function public.course_teams_autofill(uuid)                     from public, anon;

grant execute on function
  public.course_team_create(uuid, text, text), public.course_team_join(uuid), public.course_team_leave(uuid),
  public.course_team_set_role(uuid, text), public.course_team_set_responsibility(uuid, text),
  public.course_team_update(uuid, text, text), public.course_teams_state(uuid),
  public.course_teams_config(uuid, jsonb), public.course_team_move(uuid, uuid, uuid),
  public.course_team_delete(uuid), public.course_team_lock(uuid, boolean), public.course_teams_autofill(uuid)
to authenticated;
