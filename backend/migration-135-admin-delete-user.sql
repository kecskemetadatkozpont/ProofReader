-- migration-135-admin-delete-user.sql
-- Profil végleges törlése az Admin felületről.
--
-- Miért RPC és nem egyszerű DELETE: a profiles táblán nincs admin-DELETE policy, a fiók pedig
-- az auth.users sorban él — azt a kliens nem éri el. Ez a két SECURITY DEFINER függvény
-- (1) megmutatja, mi tartozik a fiókhoz, (2) törli a fiókot mindenestül.
--
-- Biztonsági korlátok: csak adminisztrátor hívhatja, admin fiókot és saját magát nem törölhet.
-- Minden törlés bekerül a naplóba (admin_deletions), hogy utólag is látszódjon, ki mit törölt.
--
-- Előfeltétel: migration-49 (is_admin), a kurzus- és kutatás-modulok táblái.
-- Ellenőrzés: select public.admin_user_footprint('<uuid>');

create table if not exists admin_deletions (
  id         bigserial primary key,
  actor      uuid references profiles(id),
  target     uuid not null,
  email      text,
  name       text,
  footprint  jsonb,
  at         timestamptz not null default now()
);
alter table admin_deletions enable row level security;
drop policy if exists ad_read on admin_deletions;
create policy ad_read on admin_deletions for select to authenticated using (is_admin());

-- Mi tartozik a fiókhoz? (a törlés előtti figyelmeztetéshez)
create or replace function public.admin_user_footprint(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not is_admin() then raise exception 'Csak adminisztrátor'; end if;
  select id, name, email, role, status, created_at into p from profiles where id = p_user;
  if p is null then raise exception 'Nincs ilyen profil'; end if;
  return jsonb_build_object(
    'id', p.id, 'name', p.name, 'email', p.email, 'role', p.role, 'status', p.status, 'created_at', p.created_at,
    'projects', (select count(*) from projects where owner_id = p_user),
    'research_projects', (select count(*) from research_projects where owner_id = p_user),
    'courses', (select count(*) from course_enrollments where user_id = p_user),
    'teams', (select count(*) from course_team_members where user_id = p_user),
    'team_tasks', (select count(*) from team_tasks where assignee = p_user or created_by = p_user),
    'files', (select count(*) from team_task_files where uploaded_by = p_user)
              + (select count(*) from team_docs where uploaded_by = p_user),
    'messages', (select count(*) from team_messages where author = p_user),
    'poll_answers', (select count(*) from course_poll_answers where user_id = p_user),
    'grades', (select count(*) from course_grades where user_id = p_user),
    'roster_rows', (select count(*) from course_roster where claimed_by = p_user));
end; $$;

-- Végleges törlés: a profil és a fiók is megszűnik.
-- A hozzá kapcsolt sorok az idegen kulcsok szerint törlődnek vagy „gazdátlanná” válnak
-- (a kurzusok, csapatok, feladatok maguk megmaradnak — csak a személy tűnik el mellőlük).
create or replace function public.admin_delete_user(p_user uuid, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare p record; fp jsonb;
begin
  if not is_admin() then raise exception 'Csak adminisztrátor'; end if;
  if p_user = auth.uid() then raise exception 'A saját fiókodat nem törölheted innen.'; end if;
  select id, name, email, role into p from profiles where id = p_user;
  if p is null then raise exception 'Nincs ilyen profil'; end if;
  if coalesce(p.role, 'user') = 'admin' then
    raise exception 'Adminisztrátor fiókot nem lehet innen törölni — előbb vedd el tőle az admin szerepet.';
  end if;
  -- gépelt megerősítés: az e-mail (vagy annak eleje) — nehogy egy félrekattintás töröljön
  if p_confirm is null or btrim(p_confirm) = ''
     or position(lower(btrim(p_confirm)) in lower(coalesce(p.email, ''))) = 0 then
    raise exception 'A megerősítéshez írd be a törlendő fiók e-mail-címét.';
  end if;

  fp := admin_user_footprint(p_user);
  insert into admin_deletions (actor, target, email, name, footprint)
  values (auth.uid(), p_user, p.email, p.name, fp);

  delete from auth.users where id = p_user;      -- a profiles sor ezzel együtt törlődik
  delete from profiles where id = p_user;        -- ha valamiért maradt volna
  return jsonb_build_object('deleted', true, 'email', p.email, 'footprint', fp);
end; $$;

revoke all on function public.admin_user_footprint(uuid)       from public, anon;
revoke all on function public.admin_delete_user(uuid, text)    from public, anon;
grant execute on function public.admin_user_footprint(uuid), public.admin_delete_user(uuid, text) to authenticated;
