-- migration-129-team-file-isolation.sql
-- BIZTONSÁGI JAVÍTÁS: a csapatok feltöltött fájljai eddig kurzus-szinten voltak olvashatók.
--
-- A 67-es migráció tárolási szabálya így szólt: a 'course-media' tárolóban bárki olvashat
-- bármit, aki a kurzus tagja. Ez a diasoroknál helyes (mindenki nézi az előadást), de a
-- csapatok munkaterénél nem: a `<kurzus>/<feltöltő>/team/…` útvonalon fekvő bizonyítékok és
-- dokumentumok bájtjai így egy másik csapat hallgatójának is letölthetők voltak, sőt a
-- tároló listázásával meg is találhatók. (Az adatbázisban a sorok RLS-e rendben volt: a
-- feladatok, üzenetek, dokumentum-rekordok nem látszottak — csak a fájl maga.)
--
-- Javítás: a 'team' szegmenst tartalmazó útvonalakat kivesszük a kurzus-szintű olvasásból,
-- és külön szabályt kapnak: csak az olvashatja, aki a feltöltővel EGY CSAPATBAN van azon a
-- kurzuson — vagy az oktató.
--
-- Előfeltétel: migration-67 (course-media), 122 (course_team_members).
-- Ellenőrzés: másik csapat tagjaként a fájl letöltése 400/403, a saját csapaté 200.

create or replace function public.shares_team(p_course uuid, p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from course_team_members a
      join course_team_members b on b.team_id = a.team_id
     where a.course_id = p_course and a.user_id = p_other and b.user_id = auth.uid());
$$;
revoke all on function public.shares_team(uuid, uuid) from public, anon;
grant execute on function public.shares_team(uuid, uuid) to authenticated;

-- ---- olvasás -----------------------------------------------------------------
-- 1. kurzus-szintű olvasás MINDENRE, ami nem csapat-fájl (diasorok, órai anyagok).
drop policy if exists cm_read on storage.objects;
create policy cm_read on storage.objects for select to authenticated
  using (bucket_id = 'course-media'
    and coalesce((storage.foldername(name))[3], '') <> 'team'
    and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then course_is_member(((storage.foldername(name))[1])::uuid)
             else false end);

-- 2. csapat-fájl: csak csapattárs vagy oktató.
drop policy if exists cm_read_team on storage.objects;
create policy cm_read_team on storage.objects for select to authenticated
  using (bucket_id = 'course-media'
    and (storage.foldername(name))[3] = 'team'
    and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then ((storage.foldername(name))[2] = auth.uid()::text                       -- a saját feltöltése
                   or shares_team(((storage.foldername(name))[1])::uuid, ((storage.foldername(name))[2])::uuid)
                   or course_is_instructor(((storage.foldername(name))[1])::uuid))
             else false end);

-- A feltöltés és a törlés szabálya változatlan (67-es migráció): feltölteni csak a saját
-- '<kurzus>/<uid>/…' mappájába lehet, törölni a feltöltő és az oktató tud.
