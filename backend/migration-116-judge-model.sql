-- ============================================================================
--  migration-116 — separate the JUDGE model from the WORKER model.
--
--  Any AI-as-judge flow (rubric scoring, protocol-step verification) must NOT run on the same model that
--  produced the material, and its cost must be visible separately. Adds an admin-set profiles.judge_model
--  plus effective_judge_model(), which defaults to the BEST model the user is allowed — judging quality
--  matters more than speed — and never to an env default.
--
--  Builds on migration-49 (allowed_models, model_allowed, effective_model, and the two profile triggers).
--  The two trigger functions are re-declared with their FULL migration-49 body plus the judge_model line;
--  keep them in sync if migration-49 ever changes.
--
--  Apply in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

-- ---- 1. column ------------------------------------------------------------
alter table public.profiles add column if not exists judge_model text;
comment on column public.profiles.judge_model is
  'Admin-set model used ONLY for AI-as-judge scoring (rubric / step verification). NULL = the best model this user is allowed. Kept inside model_allowlist by a trigger.';

-- ---- 2. effective judge model --------------------------------------------
--  Order: the admin-set judge_model (if system-active AND inside the user's allowlist)
--       → the BEST active model the user is allowed (allowed_models.sort ASC = most capable first)
--       → the cheapest active model (deterministic last resort)
create or replace function public.effective_judge_model()
returns text language sql stable security definer set search_path=public as $$
  with me as (select judge_model, model_allowlist from profiles where id = auth.uid())
  select coalesce(
    (select m.judge_model from me m
      where m.judge_model is not null
        and public.model_allowed(m.judge_model)
        and (m.model_allowlist is null or m.judge_model = any(m.model_allowlist))),
    (select am.model_id from allowed_models am, me m
      where am.active and (m.model_allowlist is null or am.model_id = any(m.model_allowlist))
      order by am.sort asc limit 1),
    (select model_id from allowed_models where active order by sort desc limit 1)
  );
$$;
revoke all on function public.effective_judge_model() from public, anon;
grant execute on function public.effective_judge_model() to authenticated;

-- ---- 3. self-lock: a user may not set their own judge model ---------------
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if public.is_admin() then return new; end if;   -- admins unrestricted
  new.role            := old.role;
  new.features        := old.features;             -- lock entitlements
  new.model_allowlist := old.model_allowlist;
  new.ai_model        := old.ai_model;
  new.judge_model     := old.judge_model;          -- migration-116
  new.can_workflows   := old.can_workflows;
  new.can_figures     := old.can_figures;
  if new.status is distinct from old.status and new.status <> 'pending' then
    new.status := old.status;
  end if;
  return new;
end; $$;

-- ---- 4. keep judge_model inside the allowlist -----------------------------
create or replace function public.enforce_model_allowlist()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.ai_model is not null and new.model_allowlist is not null
     and not (new.ai_model = any(new.model_allowlist)) then
    new.ai_model := new.model_allowlist[1];   -- first allowed, so effective_model() can't escape to env default
  end if;
  if new.judge_model is not null and new.model_allowlist is not null
     and not (new.judge_model = any(new.model_allowlist)) then
    new.judge_model := null;                  -- fall back to effective_judge_model()'s "best allowed"
  end if;
  return new;
end; $$;
-- the triggers themselves are unchanged (created in migration-03 / migration-49)

-- verify after apply:
--   select public.effective_judge_model();     -- a model id, never null
--   select judge_model from public.profiles where id = auth.uid();
