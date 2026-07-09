-- ============================================================================
--  Publify — migration 54: admins bypass feature entitlements
--
--  Makes is_feature_enabled() return true for admins for EVERY feature key, so an
--  admin automatically has all features server-side (matching the nav/page bypass
--  and the is_active() admin exemption). No edge-function redeploy needed — every
--  AI function calls this RPC, so the change takes effect immediately on apply.
--
--  NOTE: two legacy gates are checked DIRECTLY against their own columns, not via
--  is_feature_enabled — so they are NOT auto-granted to admins by this migration:
--    - claude-session workflow mode → profiles.can_workflows
--    - paper-figure                 → profiles.can_figures
--  Toggle those two per-admin in Admin → the user's drawer if needed.
--
--  Apply in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

create or replace function public.is_feature_enabled(p_key text)
returns boolean language sql stable security definer set search_path=public as $$
  select case
    when auth.uid() is null then false
    when public.is_admin() then true                                              -- admins have every feature
    when not exists (select 1 from profiles where id = auth.uid()) then false     -- missing row = closed
    else coalesce(
      -- legacy bridge: these two keys are governed by the existing boolean columns
      (case p_key
         when 'session_workflow_mode' then (select can_workflows from profiles where id = auth.uid())
         when 'paper_figure'          then (select can_figures   from profiles where id = auth.uid())
         else null end),
      -- explicit per-user grant/revoke
      (select (features -> p_key)::boolean from profiles where id = auth.uid()),
      -- catalog default
      (select default_on from feature_catalog where key = p_key),
      false)                                                                       -- unknown key = closed
  end;
$$;

-- Verify after apply (as an admin session): select public.is_feature_enabled('elicit_search');  -- true
