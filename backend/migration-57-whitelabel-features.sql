-- ============================================================================
--  Publify — migration 57: white-label the research-engine feature labels
--
--  The admin feature-permission matrix renders feature_catalog.label directly.
--  Users should not see the backend engine's brand, so relabel the elicit_* rows
--  to Publify-branded names. Keys are UNCHANGED (they back entitlements + edge
--  enforcement) — only the human-facing label changes.
--
--  Apply in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

update public.feature_catalog set label = 'Publify — paper search'              where key = 'elicit_search';
update public.feature_catalog set label = 'Publify — clinical trials'           where key = 'elicit_trials';
update public.feature_catalog set label = 'Publify — automated reports'         where key = 'elicit_reports';
update public.feature_catalog set label = 'Publify — systematic reviews'        where key = 'elicit_sysreview';
update public.feature_catalog set label = 'Publify — research tools in Chat (MCP)' where key = 'elicit_mcp';

-- Verify:  select key, label from feature_catalog where key like 'elicit_%' order by sort;
