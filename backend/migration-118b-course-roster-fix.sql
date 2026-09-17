-- migration-118b: javítás — a profiles névmezője 'name', nem 'full_name'.
-- Csak a két érintett függvényt cseréli le; a 118 többi része érintetlen.

create or replace function public.course_roster_list(p_course uuid, p_filter text default 'all', p_q text default null)
returns table (id uuid, name text, neptun text, program text, subject_code text, extra boolean,
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
           pgp_sym_decrypt(r.name_enc, k),
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
            or pgp_sym_decrypt(r.name_enc, k)   ilike '%' || p_q || '%'
            or pgp_sym_decrypt(r.neptun_enc, k) ilike '%' || p_q || '%')
     order by 2;
end; $$;

create or replace function public.course_roster_requests_list(p_course uuid)
returns table (id uuid, user_id uuid, user_name text, code text, status text, created_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  return query
    select q.id, q.user_id, p.name, pgp_sym_decrypt(q.code_enc, roster_key()), q.status, q.created_at
      from course_roster_requests q left join profiles p on p.id = q.user_id
     where q.course_id = p_course and q.status = 'pending'
     order by q.created_at;
end; $$;

create or replace function public.course_roster_decide(p_request uuid, p_ok boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare q record; row_id uuid; k text; nm text;
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

  k := roster_key();
  select id into row_id from course_roster
   where course_id = q.course_id and neptun_hmac = q.code_hmac and claimed_by is null;
  if row_id is null then
    select coalesce(name, 'Ismeretlen') into nm from profiles where id = q.user_id;
    insert into course_roster (course_id, neptun_hmac, neptun_enc, name_enc, extra, created_by)
    values (q.course_id, q.code_hmac, q.code_enc, pgp_sym_encrypt(nm, k), true, auth.uid())
    on conflict (course_id, neptun_hmac) do update set extra = course_roster.extra
    returning id into row_id;
  end if;
  update course_roster set claimed_by = q.user_id, claimed_at = now() where id = row_id and claimed_by is null;
  update course_roster_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), note = p_note
   where id = p_request;
  insert into course_roster_access_log (course_id, actor, action) values (q.course_id, auth.uid(), 'decide');
  return jsonb_build_object('status', 'approved');
end; $$;
