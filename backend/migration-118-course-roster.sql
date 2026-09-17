-- migration-118-course-roster.sql
-- Kurzus-névsor (Neptun-export) titkosítva + hallgatói önpárosítás + pontok/jegyek.
--
-- Miért így:
--   * A Neptun-export NEM tartalmaz e-mail-címet, tehát fiókot nem tudunk nyitni a
--     hallgatóknak. A hallgató maga regisztrál, belép a kurzuskóddal, és a saját
--     Neptun-kódjával párosítja magát a névsorhoz — ez köti össze a fiókot a jeggyel.
--   * A név és a Neptun-kód TITKOSÍTVA áll a táblában (pgp_sym_encrypt), a kulcs a
--     Supabase Vaultban. A párosítás kulcsos HMAC-en megy, így visszafejtés nélkül
--     is eldönthető, hogy egy megadott kód szerepel-e a névsorban. Kulcs nélkül a
--     6 karakteres Neptun-kód sima hash-ből néhány perc alatt visszafejthető volna.
--   * A táblákhoz NINCS közvetlen RLS-olvasás: minden hozzáférés SECURITY DEFINER
--     RPC-n megy, amely oktatói jogot ellenőriz és naplóz (course_roster_access_log).
--
-- Előfeltétel: migration-66 (courses, course_enrollments, lab_grades, course_role…).
-- Kapcsolódik: migration-117 (élő előadás — az órai aktivitás pontszámításhoz).
--
-- Ellenőrzés futtatás után:
--   select count(*) from vault.decrypted_secrets where name = 'course_roster_key';   -- 1
--   select public.course_roster_stats('<course-uuid>');                              -- {"total":0,…}

create extension if not exists pgcrypto with schema extensions;

-- ---- 0. titkosítási kulcs a Vaultban ----------------------------------------
-- Egyszer jön létre, véletlenszerűen. A kulcsot sehol nem írjuk ki; ha elveszik,
-- a névsor visszafejthetetlen (újra kell importálni a Neptun-exportot).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'course_roster_key') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'course_roster_key',
                                'Kurzus-névsor (név + Neptun-kód) titkosítási kulcsa');
  end if;
end $$;

create or replace function public.roster_key() returns text
language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'course_roster_key' limit 1;
$$;
revoke all on function public.roster_key() from public, anon, authenticated;

create or replace function public.roster_hmac(p_code text) returns text
language sql stable security definer set search_path = public, extensions as $$
  select encode(extensions.hmac(upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')),
                                public.roster_key() || ':neptun', 'sha256'), 'hex');
$$;
revoke all on function public.roster_hmac(text) from public, anon, authenticated;

-- ---- 1. táblák --------------------------------------------------------------

create table if not exists course_roster (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references courses(id) on delete cascade,
  neptun_hmac  text not null,                       -- kulcsos lenyomat: párosítás visszafejtés nélkül
  neptun_enc   bytea not null,                      -- pgp_sym_encrypt(Neptun-kód)
  name_enc     bytea not null,                      -- pgp_sym_encrypt(név)
  program      text,                                -- képzés (nem személyes önmagában)
  subject_code text,                                -- felvett tárgy neve/kódja — csak címke
  extra        boolean not null default false,      -- oktatói jóváhagyással utólag felvett sor
  claimed_by   uuid references profiles(id) on delete set null,
  claimed_at   timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid references profiles(id)
);
create unique index if not exists cr_course_hmac_idx on course_roster(course_id, neptun_hmac);
create unique index if not exists cr_course_claim_idx on course_roster(course_id, claimed_by) where claimed_by is not null;
create index if not exists cr_course_idx on course_roster(course_id);

create table if not exists course_roster_requests (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references courses(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  code_enc   bytea not null,                        -- amit a hallgató beírt (titkosítva)
  code_hmac  text not null,
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  note       text,
  created_at timestamptz not null default now(),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  unique (course_id, user_id)                       -- egy nyitott kérelem / hallgató
);
create index if not exists crr_course_idx on course_roster_requests(course_id, status);

create table if not exists course_grades (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  points      numeric not null default 0,
  breakdown   jsonb not null default '{}'::jsonb,   -- {lab: x, activity: y, extra: z}
  grade       int check (grade between 1 and 5),
  manual      boolean not null default false,       -- kézi felülírás: az újraszámolás nem bántja
  note        text,
  updated_by  uuid references profiles(id),
  updated_at  timestamptz not null default now(),
  unique (course_id, user_id)
);
create index if not exists cg_course_idx on course_grades(course_id);

create table if not exists course_roster_access_log (
  id        bigserial primary key,
  course_id uuid references courses(id) on delete cascade,
  actor     uuid references profiles(id),
  action    text not null,                          -- import | list | export | claim_try | claim_ok | decide | grade
  n         int,
  at        timestamptz not null default now()
);
create index if not exists cral_course_idx on course_roster_access_log(course_id, at desc);
create index if not exists cral_actor_idx  on course_roster_access_log(actor, action, at desc);

-- ---- 2. RLS: közvetlen hozzáférés sehol, csak RPC-n át ----------------------
alter table course_roster            enable row level security;
alter table course_roster_requests   enable row level security;
alter table course_grades            enable row level security;
alter table course_roster_access_log enable row level security;

-- course_roster / requests / log: nincs policy → az RPC-ken kívül senki nem olvassa.
-- Jegy: a hallgató a SAJÁTJÁT látja, az oktató a kurzusáét; írás csak RPC-n.
drop policy if exists cg_read on course_grades;
create policy cg_read on course_grades for select to authenticated
  using (user_id = auth.uid() or course_is_instructor(course_id));

-- ---- 3. segédfüggvények -----------------------------------------------------

create or replace function public.roster_required(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (settings->>'require_roster')::boolean from courses where id = cid), false);
$$;

create or replace function public.roster_verified(cid uuid, uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from course_roster where course_id = cid and claimed_by = uid);
$$;
revoke all on function public.roster_required(uuid) from public, anon;
revoke all on function public.roster_verified(uuid, uuid) from public, anon;
grant execute on function public.roster_required(uuid), public.roster_verified(uuid, uuid) to authenticated;

-- A kurzustartalom zárolása, amíg a hallgató nincs a névsorhoz kötve.
-- CSAK arra a kurzusra hat, ahol settings.require_roster = true; minden más
-- kurzus viselkedése változatlan. Az oktatókat/demonstrátorokat sosem érinti.
create or replace function public.course_is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.course_role(cid) in ('oktato','demonstrator'))
      or (public.course_role(cid) = 'hallgato'
          and (not public.roster_required(cid) or public.roster_verified(cid)));
$$;

-- ---- 4. névsor importálása (oktató) -----------------------------------------
-- p_rows: [{"neptun":"ABC123","name":"Teljes Név","program":"…","subject":"…"}, …]
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
    if code !~ '^[A-Z0-9]{5,8}$' or coalesce(r->>'name','') = '' then bad := bad + 1; continue; end if;
    insert into course_roster (course_id, neptun_hmac, neptun_enc, name_enc, program, subject_code, created_by)
    values (p_course, roster_hmac(code),
            pgp_sym_encrypt(code, k), pgp_sym_encrypt(r->>'name', k),
            nullif(r->>'program',''), nullif(r->>'subject',''), auth.uid())
    on conflict (course_id, neptun_hmac) do update
      set name_enc = excluded.name_enc, program = excluded.program, subject_code = excluded.subject_code
    returning (xmax = 0) into was_new;   -- xmax = 0 marks a fresh insert, non-zero an update
    if was_new then ins := ins + 1; else upd := upd + 1; end if;
  end loop;
  insert into course_roster_access_log (course_id, actor, action, n) values (p_course, auth.uid(), 'import', n);
  return jsonb_build_object('total', n, 'inserted', ins, 'updated', upd, 'invalid', bad,
                            'roster', (select count(*) from course_roster where course_id = p_course));
end; $$;

-- ---- 5. névsor listázása / statisztika (oktató) -----------------------------
create or replace function public.course_roster_stats(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  return jsonb_build_object(
    'total',   (select count(*) from course_roster where course_id = p_course),
    'claimed', (select count(*) from course_roster where course_id = p_course and claimed_by is not null),
    'pending', (select count(*) from course_roster_requests where course_id = p_course and status = 'pending'),
    'graded',  (select count(*) from course_grades where course_id = p_course and grade is not null),
    'joined',  (select count(*) from course_enrollments where course_id = p_course and role = 'hallgato' and status = 'active'));
end; $$;

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

-- ---- 6. hallgatói párosítás -------------------------------------------------
-- A hallgató a saját Neptun-kódját adja meg. Egyezés → azonnal névsorhoz kötjük.
-- Nincs egyezés → jóváhagyásra váró kérelem lesz belőle (az oktató dönt).
-- Próbálkozási korlát: óránként 8 — a HMAC-keresés különben találgatható volna.
create or replace function public.course_roster_claim(p_course uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare code text; hm text; row_id uuid; taken uuid; tries int; k text;
begin
  if course_role(p_course) is null then raise exception 'Előbb lépj be a kurzusra a kurzuskóddal'; end if;
  select count(*) into tries from course_roster_access_log
   where actor = auth.uid() and action = 'claim_try' and at > now() - interval '1 hour';
  if tries >= 8 then raise exception 'Túl sok próbálkozás — várj egy órát, vagy szólj az oktatónak.'; end if;
  insert into course_roster_access_log (course_id, actor, action) values (p_course, auth.uid(), 'claim_try');

  code := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  if code !~ '^[A-Z0-9]{5,8}$' then raise exception 'A Neptun-kód 6 karakter, betűk és számok.'; end if;
  if exists (select 1 from course_roster where course_id = p_course and claimed_by = auth.uid()) then
    return jsonb_build_object('status', 'already');
  end if;

  hm := roster_hmac(code);
  select id, claimed_by into row_id, taken from course_roster where course_id = p_course and neptun_hmac = hm;

  if row_id is not null and taken is null then
    update course_roster set claimed_by = auth.uid(), claimed_at = now() where id = row_id;
    update course_roster_requests set status = 'approved', decided_at = now()
     where course_id = p_course and user_id = auth.uid() and status = 'pending';
    insert into course_roster_access_log (course_id, actor, action) values (p_course, auth.uid(), 'claim_ok');
    return jsonb_build_object('status', 'ok');
  end if;

  if row_id is not null and taken is not null then
    return jsonb_build_object('status', 'taken');   -- a kódot már más fiók használja
  end if;

  k := roster_key();
  insert into course_roster_requests (course_id, user_id, code_enc, code_hmac)
  values (p_course, auth.uid(), pgp_sym_encrypt(code, k), hm)
  on conflict (course_id, user_id) do update
    set code_enc = excluded.code_enc, code_hmac = excluded.code_hmac,
        status = 'pending', created_at = now(), decided_by = null, decided_at = null, note = null;
  return jsonb_build_object('status', 'pending');
end; $$;

-- A hallgató saját állapota (a kurzus címével együtt, mert zárolt kurzust nem olvashat).
create or replace function public.course_my_roster(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r record; g record; c record;
begin
  if course_role(p_course) is null then raise exception 'Nem vagy a kurzus résztvevője'; end if;
  select title, (settings->>'require_roster')::boolean as req into c from courses where id = p_course;
  select pgp_sym_decrypt(neptun_enc, roster_key()) as neptun, subject_code into r
    from course_roster where course_id = p_course and claimed_by = auth.uid();
  select points, grade, note into g from course_grades where course_id = p_course and user_id = auth.uid();
  return jsonb_build_object(
    'course_title', c.title, 'required', coalesce(c.req, false),
    'verified', r.neptun is not null, 'neptun', r.neptun, 'subject_code', r.subject_code,
    'request', (select status from course_roster_requests where course_id = p_course and user_id = auth.uid()),
    'points', g.points, 'grade', g.grade, 'note', g.note);
end; $$;

-- ---- 7. jóváhagyás (oktató) -------------------------------------------------
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

-- p_ok = true → a hallgatót a névsorhoz kötjük. Ha van egyező (szabad) sor, ahhoz;
-- egyébként új, „extra” sort veszünk fel a beírt kóddal és a fiók nevével.
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

-- Tévesen párosított sor leválasztása (a hallgató újra próbálkozhat).
create or replace function public.course_roster_unclaim(p_roster uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select course_id into cid from course_roster where id = p_roster;
  if cid is null or not course_is_instructor(cid) then raise exception 'Nincs jogosultság'; end if;
  update course_roster set claimed_by = null, claimed_at = null where id = p_roster;
  insert into course_roster_access_log (course_id, actor, action) values (cid, auth.uid(), 'decide');
end; $$;

-- ---- 8. pontok és jegyek ----------------------------------------------------
-- settings.grades = {"max_points":100, "activity_points":10, "cut":{"2":51,"3":63,"4":75,"5":87}}
create or replace function public.course_grade_scale(cid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select settings->'grades' from courses where id = cid),
                  '{"max_points":100,"activity_points":10,"cut":{"2":51,"3":63,"4":75,"5":87}}'::jsonb);
$$;
revoke all on function public.course_grade_scale(uuid) from public, anon;
grant execute on function public.course_grade_scale(uuid) to authenticated;

create or replace function public.grade_from_points(p_points numeric, p_scale jsonb) returns int
language sql immutable as $$
  select case
    when p_points is null then null
    when p_points >= (p_scale->'cut'->>'5')::numeric * coalesce((p_scale->>'max_points')::numeric, 100) / 100 then 5
    when p_points >= (p_scale->'cut'->>'4')::numeric * coalesce((p_scale->>'max_points')::numeric, 100) / 100 then 4
    when p_points >= (p_scale->'cut'->>'3')::numeric * coalesce((p_scale->>'max_points')::numeric, 100) / 100 then 3
    when p_points >= (p_scale->'cut'->>'2')::numeric * coalesce((p_scale->>'max_points')::numeric, 100) / 100 then 2
    else 1 end;
$$;

-- Újraszámolás: labor-pontok + órai aktivitás (a megválaszolt szavazások aránya).
-- A kézzel felülírt sorokat (manual = true) nem bántja.
create or replace function public.course_grade_recalc(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sc jsonb; n int := 0; act_max numeric; runs int;
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  sc := course_grade_scale(p_course);
  act_max := coalesce((sc->>'activity_points')::numeric, 0);
  select count(*) into runs from course_poll_runs where course_id = p_course;

  with lab as (
    select s.user_id, sum(g.points) as pts
      from lab_grades g join lab_submissions s on s.id = g.submission_id
     where g.course_id = p_course group by s.user_id),
  act as (
    select a.user_id, count(distinct a.run_id) as answered
      from course_poll_answers a where a.course_id = p_course group by a.user_id),
  base as (
    select r.claimed_by as user_id,
           coalesce(l.pts, 0) as lab,
           case when runs > 0 then round(coalesce(a.answered, 0)::numeric / runs * act_max, 1) else 0 end as activity
      from course_roster r
      left join lab l on l.user_id = r.claimed_by
      left join act a on a.user_id = r.claimed_by
     where r.course_id = p_course and r.claimed_by is not null)
  insert into course_grades (course_id, user_id, points, breakdown, grade, updated_by, updated_at)
  select p_course, user_id, lab + activity,
         jsonb_build_object('lab', lab, 'activity', activity),
         grade_from_points(lab + activity, sc), auth.uid(), now()
    from base
  on conflict (course_id, user_id) do update
    set points = excluded.points, breakdown = excluded.breakdown,
        grade = case when course_grades.manual then course_grades.grade else excluded.grade end,
        updated_by = auth.uid(), updated_at = now()
    where not course_grades.manual;
  get diagnostics n = row_count;
  insert into course_roster_access_log (course_id, actor, action, n) values (p_course, auth.uid(), 'grade', n);
  return jsonb_build_object('updated', n, 'polls', runs, 'activity_points', act_max);
end; $$;

-- Kézi jegy/pont felülírás (indoklással). p_grade = null → visszaáll a számolt értékre.
create or replace function public.course_grade_set(p_course uuid, p_user uuid, p_grade int, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  if p_grade is not null and (p_grade < 1 or p_grade > 5) then raise exception 'A jegy 1 és 5 közötti'; end if;
  insert into course_grades (course_id, user_id, grade, manual, note, updated_by, updated_at)
  values (p_course, p_user, p_grade, p_grade is not null, p_note, auth.uid(), now())
  on conflict (course_id, user_id) do update
    set grade = coalesce(excluded.grade, grade_from_points(course_grades.points, course_grade_scale(p_course))),
        manual = excluded.manual, note = excluded.note, updated_by = auth.uid(), updated_at = now();
  insert into course_roster_access_log (course_id, actor, action, n) values (p_course, auth.uid(), 'grade', 1);
  return jsonb_build_object('ok', true);
end; $$;

-- Neptun-feltöltéshez: visszafejtés CSAK itt történik, és naplózzuk.
create or replace function public.course_grade_export(p_course uuid)
returns table (neptun text, name text, subject_code text, points numeric, grade int, claimed boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare k text;
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  k := roster_key();
  insert into course_roster_access_log (course_id, actor, action,
    n) values (p_course, auth.uid(), 'export', (select count(*) from course_roster where course_id = p_course));
  return query
    select pgp_sym_decrypt(r.neptun_enc, k), pgp_sym_decrypt(r.name_enc, k), r.subject_code,
           g.points, g.grade, r.claimed_by is not null
      from course_roster r
      left join course_grades g on g.course_id = r.course_id and g.user_id = r.claimed_by
     where r.course_id = p_course
     order by r.subject_code nulls last, 2;
end; $$;

-- Névsor törlése a jegyek lezárása után (adatminimalizálás). A jegyek megmaradnak.
create or replace function public.course_roster_purge(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  delete from course_roster where course_id = p_course;
  get diagnostics n = row_count;
  delete from course_roster_requests where course_id = p_course;
  insert into course_roster_access_log (course_id, actor, action, n) values (p_course, auth.uid(), 'purge', n);
  return jsonb_build_object('deleted', n);
end; $$;

-- ---- 9. jogosultságok -------------------------------------------------------
revoke all on function public.course_roster_import(uuid, jsonb)        from public, anon;
revoke all on function public.course_roster_stats(uuid)                from public, anon;
revoke all on function public.course_roster_list(uuid, text, text)     from public, anon;
revoke all on function public.course_roster_claim(uuid, text)          from public, anon;
revoke all on function public.course_my_roster(uuid)                   from public, anon;
revoke all on function public.course_roster_requests_list(uuid)        from public, anon;
revoke all on function public.course_roster_decide(uuid, boolean, text) from public, anon;
revoke all on function public.course_roster_unclaim(uuid)              from public, anon;
revoke all on function public.course_grade_recalc(uuid)                from public, anon;
revoke all on function public.course_grade_set(uuid, uuid, int, text)  from public, anon;
revoke all on function public.course_grade_export(uuid)                from public, anon;
revoke all on function public.course_roster_purge(uuid)                from public, anon;

grant execute on function
  public.course_roster_import(uuid, jsonb), public.course_roster_stats(uuid),
  public.course_roster_list(uuid, text, text), public.course_roster_claim(uuid, text),
  public.course_my_roster(uuid), public.course_roster_requests_list(uuid),
  public.course_roster_decide(uuid, boolean, text), public.course_roster_unclaim(uuid),
  public.course_grade_recalc(uuid), public.course_grade_set(uuid, uuid, int, text),
  public.course_grade_export(uuid), public.course_roster_purge(uuid), public.grade_from_points(numeric, jsonb)
to authenticated;

-- ---- 10. zárolt kurzusok listája a hallgatónak ------------------------------
-- A courses_read policy a course_is_member()-en át már NEM engedi be a névsorhoz
-- még nem kötött hallgatót, ezért a kurzusai listáját külön RPC adja vissza.
create or replace function public.course_my_courses()
returns table (course_id uuid, title text, role text, locked boolean, request text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select c.id, c.title, e.role,
           (e.role = 'hallgato' and roster_required(c.id) and not roster_verified(c.id, auth.uid())),
           (select status from course_roster_requests q where q.course_id = c.id and q.user_id = auth.uid())
      from course_enrollments e join courses c on c.id = e.course_id
     where e.user_id = auth.uid() and e.status = 'active'
     order by c.created_at desc;
end; $$;
revoke all on function public.course_my_courses() from public, anon;
grant execute on function public.course_my_courses() to authenticated;
