-- migration-107-research-agents-entitlement.sql
-- Adds the `research_agents` feature key to the entitlement catalog so an admin can grant the multi-agent
-- swarm mode (Planner + parallel Researchers + Reviewer + Synthesizer) per colleague. One swarm turn fires
-- several Anthropic calls (≈ planner + N researchers + reviewer + synth), so it is COST-HEAVY.
--
-- The Ideas chat's 🤖 toggle routes to the research-agents edge fn, which calls assertEntitled('research_agents').
-- default_on=false, enforced=true → OFF for everyone by default (cost control), server-enforced boundary.
-- Pure catalog INSERT — does NOT redefine is_feature_enabled(), so migration-54's admin bypass stays intact.
-- Apply in the Supabase SQL editor. Idempotent — safe to re-run.
insert into public.feature_catalog (key, label, category, default_on, enforced, sort) values
  ('research_agents', 'Research Chat — Multi-Agent Swarm', 'ai', false, true, 26)
on conflict (key) do update
  set label = excluded.label, category = excluded.category,
      default_on = excluded.default_on, enforced = excluded.enforced, sort = excluded.sort;

-- Grant to a specific colleague (example):
--   update public.profiles set features = features || '{"research_agents":true}'::jsonb where email = '<colleague@…>';
-- verify:
--   select key, default_on, enforced from public.feature_catalog where key = 'research_agents';
