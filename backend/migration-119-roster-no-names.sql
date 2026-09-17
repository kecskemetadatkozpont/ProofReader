-- migration-119-roster-no-names.sql
-- Adatminimalizálás: a névsorból kimarad a NÉV. Csak a Neptun-kód (titkosítva) + a
-- képzés és a tárgykód kerül fel; a hallgatót a saját fiókja neve azonosítja, miután
-- azonosította magát. Ezzel a kurzus névsora önmagában nem árulja el, ki kicsoda.
--
-- Előfeltétel: migration-118 + 118b. Futtatás után a 118 name_enc oszlopa megszűnik,
-- a benne tárolt nevek visszaállíthatatlanul törlődnek (a Neptun-kódok megmaradnak).
--
-- Ellenőrzés:
--   select column_name from information_schema.columns
--    where table_name = 'course_roster';          -- name_enc nincs benne
--   select public.course_roster_stats('<course-uuid>');

alter table course_roster drop column if exists name_enc;

-- ---- import: név nélkül ------------------------------------------------------
-- p_rows: [{"neptun":"ABC123","program":"…","subject":"…"}, …]
create or replace function public.course_roster_import(p_course uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb; k text; code text; was_new boolean; ins int := 0; upd int := 0; bad int := 0; n int := 0;
begin
  if not course_is_instructor(p_course) then raise exception 'Csak oktató importálhat névsort'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Hibás névsor-formátum'; end if;
  k := roster_key();
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    code := upper(regexp_replace(coalesce(r->>'neptun',''), '\s', '', 'g'));
    if code !~ '^[A-Z0-9]{5,8}$' then bad := bad + 1; continue; end if;
    insert into course_roster (course_id, neptun_hmac, neptun_enc, program, subject_code, created_by)
    values (p_course, roster_hmac(code), pgp_sym_encrypt(code, k),
            nullif(r->>'program',''), nullif(r->>'subject',''), auth.uid())
    on conflict (course_id, neptun_hmac) do update
      set program = excluded.program, subject_code = excluded.subject_code
    returning (xmax = 0) into was_new;
    if was_new then ins := ins + 1; else upd := upd + 1; end if;
  end loop;
  insert into course_roster_access_log (course_id, actor, action, n) values (p_course, auth.uid(), 'import', n);
  return jsonb_build_object('total', n, 'inserted', ins, 'updated', upd, 'invalid', bad,
                            'roster', (select count(*) from course_roster where course_id = p_course));
end; $$;

-- ---- listázás: a név helyén a párosított fiók neve áll ----------------------
drop function if exists public.course_roster_list(uuid, text, text);
create or replace function public.course_roster_list(p_course uuid, p_filter text default 'all', p_q text default null)
returns table (id uuid, neptun text, program text, subject_code text, extra boolean,
               user_id uuid, user_name text, claimed_at timestamptz,
               points numeric, grade int, manual boolean, note text)
language plpgsql security definer set search_path = public, extensions as $$
declare k text;
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  k := roster_key();
  insert into course_roster_access_log (course_id, actor, action) values (p_course, auth.uid(), 'list');
  return query
    select r.id,
           pgp_sym_decrypt(r.neptun_enc, k),
           r.program, r.subject_code, r.extra,
           r.claimed_by, p.name, r.claimed_at,
           g.points, g.grade, coalesce(g.manual, false), g.note
      from course_roster r
      left join profiles p      on p.id = r.claimed_by
      left join course_grades g on g.course_id = r.course_id and g.user_id = r.claimed_by
     where r.course_id = p_course
       and (p_filter = 'all'
            or (p_filter = 'claimed' and r.claimed_by is not null)
            or (p_filter = 'missing' and r.claimed_by is null)
            or (p_filter = 'graded'  and g.grade is not null)
            or (p_filter = 'ungraded' and g.grade is null))
       and (p_q is null or p_q = ''
            or pgp_sym_decrypt(r.neptun_enc, k) ilike '%' || p_q || '%'
            or coalesce(p.name, '') ilike '%' || p_q || '%')
     order by 2;
end; $$;

-- ---- jóváhagyás: nincs mit titkosítani a névből -----------------------------
create or replace function public.course_roster_decide(p_request uuid, p_ok boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare q record; row_id uuid;
begin
  select * into q from course_roster_requests where id = p_request;
  if q is null then raise exception 'Nincs ilyen kérelem'; end if;
  if not course_is_instructor(q.course_id) then raise exception 'Nincs jogosultság'; end if;

  if not p_ok then
    update course_roster_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), note = p_note
     where id = p_request;
    insert into course_roster_access_log (course_id, actor, action) values (q.course_id, auth.uid(), 'decide');
    return jsonb_build_object('status', 'rejected');
  end if;

  select id into row_id from course_roster
   where course_id = q.course_id and neptun_hmac = q.code_hmac and claimed_by is null;
  if row_id is null then
    insert into course_roster (course_id, neptun_hmac, neptun_enc, extra, created_by)
    values (q.course_id, q.code_hmac, q.code_enc, true, auth.uid())
    on conflict (course_id, neptun_hmac) do update set extra = course_roster.extra
    returning id into row_id;
  end if;
  update course_roster set claimed_by = q.user_id, claimed_at = now() where id = row_id and claimed_by is null;
  update course_roster_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), note = p_note
   where id = p_request;
  insert into course_roster_access_log (course_id, actor, action) values (q.course_id, auth.uid(), 'decide');
  return jsonb_build_object('status', 'approved');
end; $$;

-- ---- export: Neptun-kód + (ha van) a fiók neve ------------------------------
drop function if exists public.course_grade_export(uuid);
create or replace function public.course_grade_export(p_course uuid)
returns table (neptun text, account text, subject_code text, points numeric, grade int, claimed boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare k text;
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  k := roster_key();
  insert into course_roster_access_log (course_id, actor, action, n)
    values (p_course, auth.uid(), 'export', (select count(*) from course_roster where course_id = p_course));
  return query
    select pgp_sym_decrypt(r.neptun_enc, k), p.name, r.subject_code, g.points, g.grade, r.claimed_by is not null
      from course_roster r
      left join profiles p      on p.id = r.claimed_by
      left join course_grades g on g.course_id = r.course_id and g.user_id = r.claimed_by
     where r.course_id = p_course
     order by r.subject_code nulls last, 1;
end; $$;

revoke all on function public.course_roster_import(uuid, jsonb)    from public, anon;
revoke all on function public.course_roster_list(uuid, text, text) from public, anon;
revoke all on function public.course_grade_export(uuid)            from public, anon;
grant execute on function public.course_roster_import(uuid, jsonb), public.course_roster_list(uuid, text, text),
  public.course_roster_decide(uuid, boolean, text), public.course_grade_export(uuid) to authenticated;
