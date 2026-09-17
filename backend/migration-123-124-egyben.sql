-- =====================================================================
-- migration-123-124-egyben.sql  ·  Publify / Kurzus — csapatok, 2. kör
-- =====================================================================
--   123 — Az oktató is létrehozhasson csapatot, anélkül hogy tagja lenne
--   124 — Csapatösszeállítás jóváhagyása: alakul → beküldve → jóváhagyva
--
-- Előfeltétel: a 120-122 egyben már lefutott.
-- Futtatás: Supabase → SQL Editor → beilleszt → Run. Egy tranzakcióban fut.
-- Újrafuttatható.
--
-- Ellenőrzés utána:
--   select count(*) from information_schema.columns
--    where table_name = 'course_teams' and column_name in ('status','review_note','approved_at','approved_by');
--   -- várt: 4
-- =====================================================================

begin;


-- =====================================================================
-- 123. rész — Az oktató is létrehozhasson csapatot (üresen)
-- forrás: migration-123-teams-admin-create.sql
-- =====================================================================

-- migration-123-teams-admin-create.sql
-- Az oktató is létrehozhasson csapatot — anélkül, hogy ő maga a tagja lenne.
--
-- A 122-es course_team_create mindig beírta a hívót tagnak, ami hallgatónál helyes
-- (aki alapít, az tagja is lesz), oktatónál viszont nem: ő szervez, nem játszik.
-- Ez a csere csak a tagfelvételt teszi feltételessé, minden más marad.
--
-- Előfeltétel: migration-122.
-- Ellenőrzés: oktatóként `select course_team_create('<course>','Teszt csapat', null);`
--             → a csapat létrejön, tagja nincs.

create or replace function public.course_team_create(p_course uuid, p_name text, p_goal text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; nm text; as_member boolean;
begin
  perform teams_guard(p_course);
  nm := btrim(coalesce(p_name, ''));
  if length(nm) < 2 then raise exception 'A csapatnév legalább 2 karakter.'; end if;
  if length(nm) > 60 then nm := left(nm, 60); end if;
  if exists (select 1 from course_teams where course_id = p_course and lower(name) = lower(nm)) then
    raise exception 'Ilyen nevű csapat már van — válassz másikat.';
  end if;
  -- csak a hallgató kerül be tagként; az oktató üres csapatot nyit, amit aztán feltölt
  as_member := course_role(p_course) = 'hallgato';
  if as_member and exists (select 1 from course_team_members where course_id = p_course and user_id = auth.uid()) then
    raise exception 'Már tagja vagy egy csapatnak — előbb lépj ki belőle.';
  end if;
  insert into course_teams (course_id, name, goal, created_by)
    values (p_course, nm, nullif(btrim(coalesce(p_goal, '')), ''), auth.uid())
    returning id into tid;
  if as_member then
    insert into course_team_members (team_id, course_id, user_id, role) values (tid, p_course, auth.uid(), 'dev');
  end if;
  return tid;
end; $$;
revoke all on function public.course_team_create(uuid, text, text) from public, anon;
grant execute on function public.course_team_create(uuid, text, text) to authenticated;

-- =====================================================================
-- 124. rész — Csapatösszeállítás oktatói jóváhagyása
-- forrás: migration-124-teams-approval.sql
-- =====================================================================

-- migration-124-teams-approval.sql
-- A csapatösszeállítás oktatói jóváhagyása.
--
-- Állapotok: 'forming' (alakul) → 'submitted' (beküldve) → 'approved' (jóváhagyva).
-- A csapat akkor küldheti be magát, ha eléri a minimum létszámot, és van Product Ownere
-- és Scrum Mastere. A jóváhagyott csapat összetétele befagy: hallgató nem lép be, nem lép
-- ki és nem cserél szerepet — az oktató viszont bármikor visszanyithatja vagy átrendezheti.
-- Visszaküldésnél egy rövid indoklás megy a csapatnak.
--
-- Előfeltétel: migration-122, 123.
-- Ellenőrzés: select public.course_teams_state('<course-uuid>') -> 'teams' -> 0 -> 'status';

alter table course_teams add column if not exists status      text not null default 'forming';
alter table course_teams add column if not exists review_note text;
alter table course_teams add column if not exists approved_at timestamptz;
alter table course_teams add column if not exists approved_by uuid references profiles(id);
do $$ begin
  alter table course_teams add constraint ct_status_chk check (status in ('forming', 'submitted', 'approved'));
exception when duplicate_object then null; end $$;

-- A jóváhagyott összetétel a hallgatók számára zárt (az oktatóra nem vonatkozik).
create or replace function public.team_change_guard(p_team uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare t record;
begin
  select * into t from course_teams where id = p_team;
  if t is null then raise exception 'Nincs ilyen csapat'; end if;
  if course_is_instructor(t.course_id) then return; end if;
  if t.status = 'approved' then
    raise exception 'Az oktató már jóváhagyta a csapatot — szólj neki, ha változtatnátok.';
  end if;
  if t.locked then raise exception 'Ez a csapat zárolva van.'; end if;
end; $$;
revoke all on function public.team_change_guard(uuid) from public, anon;

-- ---- belépés / kilépés / szerep: jóváhagyás után zárva --------------------
create or replace function public.course_team_join(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; cnt int; mx int;
begin
  select * into t from course_teams where id = p_team;
  if t is null then raise exception 'Nincs ilyen csapat'; end if;
  perform teams_guard(t.course_id);
  perform team_change_guard(p_team);
  if exists (select 1 from course_team_members where course_id = t.course_id and user_id = auth.uid()) then
    raise exception 'Már tagja vagy egy csapatnak — előbb lépj ki belőle.';
  end if;
  select count(*) into cnt from course_team_members where team_id = p_team;
  mx := coalesce((course_team_cfg(t.course_id)->>'max')::int, 6);
  if cnt >= mx then raise exception 'Ez a csapat betelt (% fő).', mx; end if;
  insert into course_team_members (team_id, course_id, user_id, role) values (p_team, t.course_id, auth.uid(), 'dev');
  -- egy beküldött csapat új taggal újra „alakul” állapotba kerül
  update course_teams set status = 'forming' where id = p_team and status = 'submitted';
  return jsonb_build_object('team', p_team, 'size', cnt + 1);
end; $$;

create or replace function public.course_team_leave(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid; left_cnt int;
begin
  perform teams_guard(p_course);
  select team_id into tid from course_team_members where course_id = p_course and user_id = auth.uid();
  if tid is null then raise exception 'Nem vagy csapattag.'; end if;
  perform team_change_guard(tid);
  delete from course_team_members where team_id = tid and user_id = auth.uid();
  select count(*) into left_cnt from course_team_members where team_id = tid;
  if left_cnt = 0 then delete from course_teams where id = tid;
  else update course_teams set status = 'forming' where id = tid and status = 'submitted'; end if;
  return jsonb_build_object('left', tid, 'remaining', left_cnt);
end; $$;

create or replace function public.course_team_set_role(p_course uuid, p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m record; me_team uuid; taken text;
begin
  if p_role not in ('po', 'sm', 'dev') then raise exception 'Ismeretlen szerep'; end if;
  select * into m from course_team_members where course_id = p_course and user_id = p_user;
  if m is null then raise exception 'Ez a hallgató nem csapattag.'; end if;
  select team_id into me_team from course_team_members where course_id = m.course_id and user_id = auth.uid();
  if me_team is distinct from m.team_id and not course_is_instructor(m.course_id) then
    raise exception 'Csak a saját csapatodban oszthattok szerepet.';
  end if;
  perform teams_guard(m.course_id);
  perform team_change_guard(m.team_id);
  if p_role in ('po', 'sm') then
    select p.name into taken from course_team_members x join profiles p on p.id = x.user_id
     where x.team_id = m.team_id and x.role = p_role and x.user_id <> p_user;
    if taken is not null then
      raise exception '% már % — előbb neki le kell adnia.', taken,
        case p_role when 'po' then 'Product Owner' else 'Scrum Master' end;
    end if;
  end if;
  update course_team_members set role = p_role where course_id = p_course and user_id = p_user;
  return jsonb_build_object('user', p_user, 'role', p_role);
end; $$;

-- ---- beküldés (csapattag) ---------------------------------------------------
create or replace function public.course_team_submit(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid; cnt int; mn int; has_po boolean; has_sm boolean;
begin
  perform teams_guard(p_course);
  select team_id into tid from course_team_members where course_id = p_course and user_id = auth.uid();
  if tid is null then raise exception 'Nem vagy csapattag.'; end if;
  perform team_change_guard(tid);
  select count(*), bool_or(role = 'po'), bool_or(role = 'sm') into cnt, has_po, has_sm
    from course_team_members where team_id = tid;
  mn := coalesce((course_team_cfg(p_course)->>'min')::int, 3);
  if cnt < mn then raise exception 'Legalább % fő kell a beküldéshez — most %-en vagytok.', mn, cnt; end if;
  if not has_po then raise exception 'Előbb válasszatok Product Ownert.'; end if;
  if not has_sm then raise exception 'Előbb válasszatok Scrum Mastert.'; end if;
  update course_teams set status = 'submitted', review_note = null where id = tid;
  return jsonb_build_object('team', tid, 'status', 'submitted');
end; $$;

-- Visszavonás jóváhagyás előtt (mégis dolgoznának rajta).
create or replace function public.course_team_withdraw(p_course uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  select team_id into tid from course_team_members where course_id = p_course and user_id = auth.uid();
  if tid is null then raise exception 'Nem vagy csapattag.'; end if;
  perform team_change_guard(tid);
  update course_teams set status = 'forming' where id = tid and status = 'submitted';
end; $$;

-- ---- elbírálás (oktató) -----------------------------------------------------
-- p_ok = true → jóváhagyva (az összetétel befagy), false → vissza a csapathoz indoklással.
create or replace function public.course_team_review(p_team uuid, p_ok boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select course_id into cid from course_teams where id = p_team;
  if cid is null or not course_is_instructor(cid) then raise exception 'Nincs jogosultság'; end if;
  if p_ok then
    update course_teams set status = 'approved', approved_at = now(), approved_by = auth.uid(), review_note = null
     where id = p_team;
    return jsonb_build_object('status', 'approved');
  end if;
  update course_teams set status = 'forming', approved_at = null, approved_by = null,
                          review_note = nullif(left(btrim(coalesce(p_note, '')), 300), '')
   where id = p_team;
  return jsonb_build_object('status', 'forming');
end; $$;

-- Az összes beküldött csapat jóváhagyása egy lépésben (óra végén hasznos).
create or replace function public.course_teams_approve_all(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  update course_teams set status = 'approved', approved_at = now(), approved_by = auth.uid(), review_note = null
   where course_id = p_course and status = 'submitted';
  get diagnostics n = row_count;
  return jsonb_build_object('approved', n);
end; $$;

-- ---- állapot: az új mezőkkel -----------------------------------------------
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
      'status', t.status, 'review_note', t.review_note, 'approved_at', t.approved_at,
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

revoke all on function public.course_team_submit(uuid)                     from public, anon;
revoke all on function public.course_team_withdraw(uuid)                   from public, anon;
revoke all on function public.course_team_review(uuid, boolean, text)      from public, anon;
revoke all on function public.course_teams_approve_all(uuid)               from public, anon;
grant execute on function public.course_team_submit(uuid), public.course_team_withdraw(uuid),
  public.course_team_review(uuid, boolean, text), public.course_teams_approve_all(uuid),
  public.course_team_join(uuid), public.course_team_leave(uuid),
  public.course_team_set_role(uuid, uuid, text), public.course_teams_state(uuid) to authenticated;

commit;
