-- migration-134-freeze-permissions-fix.sql
-- SÜRGŐS JAVÍTÁS a 133-ashoz.
--
-- A 133-as migráció két lépésből állt: (1) a meglévő felhasználók tényleges jogosultságainak
-- „befagyasztása” a profiljukba, (2) a katalógus alapértelmezéseinek átállítása csak-kurzusra.
-- Az (1) lépés CSENDBEN NEM HAJTÓDOTT VÉGRE: a profiles táblán ülő guard_profile_update trigger
-- minden nem-admin munkamenetben visszaírja a features mezőt (az SQL-szerkesztőben auth.uid()
-- üres, tehát is_admin() hamis). Így a (2) lépés után a korábbi felhasználók is elveszítették
-- a hozzáférésüket mindenhez a Kurzuson kívül.
--
-- Ez a migráció a triggert kikapcsolva végzi el a befagyasztást, a 133 ELŐTTI alapértelmezésekkel,
-- és az egyedi beállításokat változatlanul hagyja (azok erősebbek az alapértelmezésnél).
--
-- Ellenőrzés utána:
--   select count(*) from profiles where role <> 'admin' and features ? 'page_research';  -- minden nem-admin
--   select key, default_on from feature_catalog where default_on;                        -- csak a kurzus-kulcsok

do $$
declare old_defaults jsonb := jsonb_build_object(
  -- a 133 előtti katalógus-alapértelmezések
  'page_research', true, 'research_chat_ideas', true, 'research_web_search', false, 'research_agents', false,
  'literature_study', true, 'protocol_runner', false, 'journal_matching', true, 'research_ai_writing', true,
  'page_session', true, 'session_workflow_mode', false, 'ai_writing_assist', true, 'paper_figure', false,
  'page_memory', true, 'page_media', true, 'page_submissions', true, 'mtmt_sync', true,
  'page_compare', true, 'page_phd', true, 'page_publications', true, 'page_kanban', true,
  'elicit_search', false, 'elicit_trials', false, 'elicit_reports', false, 'elicit_sysreview', false, 'elicit_mcp', false,
  'page_course', true, 'course_mcp', true,
  'course_teams', true, 'course_team_room', true, 'course_team_chat', true, 'course_docs', true,
  'page_autopilot', true   -- az Autopilot eddig kulcs nélkül mindenkinek látszott
);
begin
  alter table public.profiles disable trigger guard_profile_update;
  -- a korábbi tényleges állapot = régi alapértelmezés, amit az egyedi beállítás felülír
  update public.profiles p
     set features = old_defaults || coalesce(p.features, '{}'::jsonb)
   where coalesce(p.role, 'user') <> 'admin';
  alter table public.profiles enable trigger guard_profile_update;
end $$;

-- A hallgatói fiókok (akik a kurzuskóddal érkeztek) szándékosan csak a Kurzust kapják:
-- náluk visszavonjuk a fenti nagyvonalú alapértelmezést, kivéve a kurzus-kulcsokat.
do $$
declare course_only jsonb := jsonb_build_object(
  'page_course', true, 'course_teams', true, 'course_team_room', true, 'course_team_chat', true,
  'course_docs', true, 'course_mcp', true,
  'page_research', false, 'page_session', false, 'page_memory', false, 'page_media', false,
  'page_submissions', false, 'page_compare', false, 'page_phd', false, 'page_publications', false,
  'page_kanban', false, 'page_autopilot', false, 'research_chat_ideas', false, 'literature_study', false,
  'journal_matching', false, 'research_ai_writing', false, 'ai_writing_assist', false, 'mtmt_sync', false,
  'protocol_runner', false, 'research_web_search', false, 'research_agents', false
);
begin
  alter table public.profiles disable trigger guard_profile_update;
  update public.profiles p
     set features = coalesce(p.features, '{}'::jsonb) || course_only
   where coalesce(p.role, 'user') <> 'admin'
     and coalesce(p.is_student, false)                      -- hallgatóként regisztrált
     and exists (select 1 from course_enrollments e where e.user_id = p.id and e.role = 'hallgato');
  alter table public.profiles enable trigger guard_profile_update;
end $$;
