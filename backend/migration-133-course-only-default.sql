-- migration-133-course-only-default.sql
-- Új alapértelmezés: egy frissen érkező felhasználó CSAK a Kurzus felületet látja.
-- Minden más menüpont és AI-funkció külön engedéllyel nyílik (Admin → Jogosultságok).
--
-- Fontos: a mostani felhasználóktól nem veszünk el semmit. Előbb „befagyasztjuk” a jelenlegi
-- tényleges jogosultságaikat a profiljukba (a katalógus-alapértelmezés + az egyedi beállításaik
-- összeolvasva), és csak utána állítjuk át a katalógus alapértelmezéseit. Így a változás csak az
-- ezután regisztrálókat érinti — és azokat, akiktől tudatosan visszaveszed.
--
-- Előfeltétel: migration-49 (feature_catalog), 130 (kurzus-kulcsok, sablonok).
-- Ellenőrzés:
--   select key, default_on from feature_catalog order by sort;     -- csak a kurzus-kulcsok true
--   select count(*) from profiles where features <> '{}'::jsonb;   -- a meglévő felhasználók megőrizve

-- ---- 1. az Autopilot is kapjon kulcsot (eddig mindenkinek látszott) ---------
insert into feature_catalog (key, label, category, default_on, enforced, sort) values
  ('page_autopilot', 'Autopilot (nav)', 'page', false, false, 255)
on conflict (key) do nothing;

-- ---- 2. a jelenlegi tényleges jogosultságok befagyasztása -------------------
-- (csak nem-admin profilokra; az admin úgyis mindent lát)
update profiles p
   set features = (
     select coalesce(jsonb_object_agg(f.key, coalesce((p.features ->> f.key)::boolean, f.default_on)), '{}'::jsonb)
       from feature_catalog f)
 where coalesce(p.role, 'user') <> 'admin';

-- ---- 3. új alapértelmezés: csak a kurzus ------------------------------------
update feature_catalog set default_on = false
 where key not in ('page_course', 'course_teams', 'course_team_room', 'course_team_chat', 'course_docs', 'course_mcp');
update feature_catalog set default_on = true
 where key in ('page_course', 'course_teams', 'course_team_room', 'course_team_chat', 'course_docs', 'course_mcp');

-- ---- 4. a „Hallgató” sablon az Autopilotot is zárja ------------------------
update permission_presets
   set features = features || jsonb_build_object('page_autopilot', false)
 where name = 'Hallgató';
update permission_presets
   set features = features || jsonb_build_object('page_autopilot', true)
 where name in ('Kutató', 'Oktató');
