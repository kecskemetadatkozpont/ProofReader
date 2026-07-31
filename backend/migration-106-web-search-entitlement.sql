-- migration-106-web-search-entitlement.sql
-- Adds the `research_web_search` feature key to the entitlement catalog so an admin can grant the paid
-- native web-search tool (Anthropic web_search, ~$10/1k searches) per colleague. The Ideas chat
-- (research-chat edge fn) enables the tool only when BOTH the per-turn 🌐 toggle is on AND
-- is_feature_enabled('research_web_search') is true (admins bypass via migration-54).
--
-- default_on=false, enforced=true  → OFF for everyone by default (cost control), server-enforced boundary.
-- Pure catalog INSERT — does NOT redefine is_feature_enabled(), so migration-54's admin bypass stays intact.
-- Apply in the Supabase SQL editor. Idempotent — safe to re-run.
insert into public.feature_catalog (key, label, category, default_on, enforced, sort) values
  ('research_web_search', 'Research Chat — Web Search', 'ai', false, true, 25)
on conflict (key) do update
  set label = excluded.label, category = excluded.category,
      default_on = excluded.default_on, enforced = excluded.enforced, sort = excluded.sort;

-- Grant to a specific colleague (example):
--   update public.profiles set features = features || '{"research_web_search":true}'::jsonb where email = '<colleague@…>';
-- verify:
--   select key, default_on, enforced from public.feature_catalog where key = 'research_web_search';
