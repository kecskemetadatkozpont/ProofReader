-- ============================================================================
--  Publify — migration 91: collaborators inherit a project owner's features.
--
--  BUG: an accepted EDITOR of a shared project could not run features the OWNER
--  can — e.g. creating a protocol failed with "Ez a funkció (protocol_runner)
--  nincs engedélyezve ehhez a felhasználóhoz." Reason: is_feature_enabled() (the
--  RPC every AI edge fn calls via assertEntitled) is a PER-USER, project-agnostic
--  check. protocol_runner (and elicit_sysreview, literature_study, …) are
--  default_on=false + enforced, so a regular collaborator is denied even while
--  editing the owner's project.
--
--  FIX: extend is_feature_enabled() with COLLABORATION INHERITANCE — a non-admin
--  caller ALSO has a feature if they are an accepted owner/editor member of some
--  project whose OWNER has that feature. An explicit per-user REVOKE
--  (features->key = false) is still respected. Preserves migration-54's admin
--  bypass and all prior logic. No entitlement.ts change / no edge-fn redeploy
--  needed — every AI fn calls this RPC. Idempotent; run in the SQL editor.
--  Requires migration-74 (research_project_members).
--
--  SCOPE NOTE: inheritance is not project-scoped (the RPC has no project_id), so a
--  collaborator who inherits a feature can also use it on their OWN projects. For a
--  trusted research group this is acceptable; usage is still attributed to (and
--  billed against) the caller, and gated to accepted owner/editor collaborators.
-- ============================================================================

-- per-user feature check for an ARBITRARY uid (used to test the project OWNER).
-- Mirrors is_feature_enabled but WITHOUT collaboration inheritance (no recursion).
create or replace function public.is_feature_enabled_for(p_uid uuid, p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_uid is null then false
    when (select role from public.profiles where id = p_uid) = 'admin' then true
    when not exists (select 1 from public.profiles where id = p_uid) then false
    else coalesce(
      (case p_key
         when 'session_workflow_mode' then (select can_workflows from public.profiles where id = p_uid)
         when 'paper_figure'          then (select can_figures   from public.profiles where id = p_uid)
         else null end),
      (select (features -> p_key)::boolean from public.profiles where id = p_uid),
      (select default_on from public.feature_catalog where key = p_key),
      false)
  end;
$$;
-- internal helper only (called from is_feature_enabled, a SECURITY DEFINER fn) — must NOT be a
-- caller-supplied-uid RPC (that would let anon enumerate any user's entitlements / admin status).
revoke all on function public.is_feature_enabled_for(uuid, text) from public, anon;

create or replace function public.is_feature_enabled(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then false
    when public.is_admin() then true                                              -- admins have every feature (migration-54)
    when not exists (select 1 from public.profiles where id = auth.uid()) then false
    else (
      public.is_feature_enabled_for(auth.uid(), p_key)                            -- the caller's own grant / catalog default
      or (
        -- inherit from a collaboration: an accepted owner/editor of a project whose OWNER has the feature.
        -- coalesce(...,true) leaves an explicit per-user REVOKE (features->p_key=false) in force.
        -- The two legacy column-gated keys are NEVER inherited (they aren't research features, and their
        -- revoke lives in can_workflows/can_figures, not features->key).
        p_key not in ('session_workflow_mode', 'paper_figure')
        and coalesce((select (features -> p_key)::boolean from public.profiles where id = auth.uid()), true)
        and exists (
          select 1 from public.research_project_members m
          join public.research_projects p on p.id = m.project_id
          where m.user_id = auth.uid() and m.accepted and m.role in ('owner', 'editor')
            and public.is_feature_enabled_for(p.owner_id, p_key)
        )
      )
    )
  end;
$$;
