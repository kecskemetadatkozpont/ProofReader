-- migration-136-neptun-later.sql
-- A Neptun-kód megadása halasztható: a hallgató beléphet nélküle is, és később pótolja.
-- Ehhez az oktatónak látnia kell, kinél hiányzik, és tudnia kell kézzel párosítani.
--
-- Előfeltétel: migration-118 (névsor), 122 (csapatok), 131 (hírfolyam nem kell, csak sorrend).
-- Ellenőrzés: select public.course_missing_codes('<course-uuid>');

-- Kinél nincs még Neptun-kód? (nincs párosítva és nincs függő kérelme sem)
create or replace function public.course_missing_codes(p_course uuid)
returns table (user_id uuid, name text, joined_at timestamptz, pending boolean, typed_code text)
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  return query
    select e.user_id, p.name, e.created_at,
           (q.id is not null) as pending,
           case when q.id is not null then pgp_sym_decrypt(q.code_enc, roster_key()) else null end
      from course_enrollments e
      join profiles p on p.id = e.user_id
      left join course_roster_requests q
             on q.course_id = p_course and q.user_id = e.user_id and q.status = 'pending'
     where e.course_id = p_course and e.role = 'hallgato' and e.status = 'active'
       and not exists (select 1 from course_roster r where r.course_id = p_course and r.claimed_by = e.user_id)
     order by (q.id is not null) desc, p.name;
end; $$;

-- Az oktató kézzel köt egy hallgatót egy névsorsorhoz (pl. az órán egyeztetve).
create or replace function public.course_roster_assign(p_roster uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from course_roster where id = p_roster;
  if r is null or not course_is_instructor(r.course_id) then raise exception 'Nincs jogosultság'; end if;
  if r.claimed_by is not null and r.claimed_by <> p_user then
    raise exception 'Ehhez a sorhoz már tartozik fiók — előbb válaszd le.';
  end if;
  if exists (select 1 from course_roster x where x.course_id = r.course_id and x.claimed_by = p_user and x.id <> p_roster) then
    raise exception 'Ez a hallgató már egy másik névsorsorhoz tartozik.';
  end if;
  update course_roster set claimed_by = p_user, claimed_at = now() where id = p_roster;
  update course_roster_requests set status = 'approved', decided_by = auth.uid(), decided_at = now()
   where course_id = r.course_id and user_id = p_user and status = 'pending';
  insert into course_roster_access_log (course_id, actor, action) values (r.course_id, auth.uid(), 'decide');
  return jsonb_build_object('ok', true);
end; $$;

-- A statisztikába is kerüljön bele, hányan vannak kód nélkül.
create or replace function public.course_roster_stats(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  return jsonb_build_object(
    'total',   (select count(*) from course_roster where course_id = p_course),
    'claimed', (select count(*) from course_roster where course_id = p_course and claimed_by is not null),
    'pending', (select count(*) from course_roster_requests where course_id = p_course and status = 'pending'),
    'graded',  (select count(*) from course_grades where course_id = p_course and grade is not null),
    'joined',  (select count(*) from course_enrollments where course_id = p_course and role = 'hallgato' and status = 'active'),
    'no_code', (select count(*) from course_enrollments e
                 where e.course_id = p_course and e.role = 'hallgato' and e.status = 'active'
                   and not exists (select 1 from course_roster r where r.course_id = p_course and r.claimed_by = e.user_id)
                   and not exists (select 1 from course_roster_requests q where q.course_id = p_course and q.user_id = e.user_id and q.status = 'pending')));
end; $$;

revoke all on function public.course_missing_codes(uuid)        from public, anon;
revoke all on function public.course_roster_assign(uuid, uuid)  from public, anon;
grant execute on function public.course_missing_codes(uuid), public.course_roster_assign(uuid, uuid),
  public.course_roster_stats(uuid) to authenticated;
