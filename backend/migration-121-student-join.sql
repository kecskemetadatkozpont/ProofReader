-- migration-121-student-join.sql
-- Hallgatói önkiszolgáló belépés: a kurzuskód beváltásához NEM kell adminisztrátori
-- jóváhagyás. A hallgató regisztrál, beváltja a kurzuskódot, és a Neptun-kódjával
-- azonosítja magát — a névsorban szereplő kód maga a bizonyíték, hogy felvette a tárgyat.
--
-- Miért biztonságos:
--   * A fiók státusza NEM változik (marad 'incomplete'/'pending') → semmilyen kutatói
--     vagy AI-funkciót nem nyit meg; azok külön az is_active()/entitlement-kapun mennek.
--     A hallgató csak a kurzus tartalmát éri el, azt is csak a névsorhoz kötés után
--     (migration-118: require_roster + course_is_member).
--   * Felfüggesztett és elutasított fiók továbbra sem léphet be sehová.
--   * A kurzuskód titok; a névsorhoz kötés pedig kulcsos HMAC-en megy (8 próba/óra).
--
-- Előfeltétel: migration-66 (course_join), 118 (névsor).
-- Ellenőrzés: egy 'pending' fiókkal a course_join már nem 'A fiók még nincs jóváhagyva.'-t ad.

create or replace function public.course_join(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; st text;
begin
  select status into st from profiles where id = auth.uid();
  if st is null then raise exception 'Nincs profilod — jelentkezz be újra.'; end if;
  if st in ('suspended', 'rejected') then
    raise exception 'A fiókod nem aktív — fordulj az adminisztrátorhoz.';
  end if;
  -- 'incomplete' és 'pending' is beléphet: a kurzuskód + Neptun-kód a hallgatói azonosítás.
  select id into cid from courses where join_code = p_code and active;
  if cid is null then raise exception 'Érvénytelen kurzuskód'; end if;
  -- review fix (migration-66): egy eltávolított (dropped) beiratkozás NEM éledhet újra a kóddal
  insert into course_enrollments (course_id, user_id, role)
    values (cid, auth.uid(), 'hallgato')
    on conflict (course_id, user_id) do update set status = 'active'
      where course_enrollments.status <> 'dropped';
  if not found then
    raise exception 'A kurzusból eltávolítottak — kérj új hozzáférést az oktatótól.';
  end if;
  return cid;
end; $$;
revoke all on function public.course_join(text) from public, anon;
grant execute on function public.course_join(text) to authenticated;

-- A hallgató a saját kurzusait akkor is lássa, ha a fiókja még jóváhagyásra vár:
-- a course_my_courses (migration-118) ezt már definer-ként adja vissza, itt csak
-- kiegészítjük azzal, hogy a kurzus kódját sosem adjuk ki hallgatónak.
comment on function public.course_my_courses() is
  'A bejelentkezett felhasználó aktív kurzusai + zárolt-e még a névsor-azonosítás miatt. Kurzuskódot nem ad vissza.';
