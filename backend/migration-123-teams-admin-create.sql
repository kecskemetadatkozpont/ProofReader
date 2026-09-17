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
