-- ============================================================================
--  Publify — migration 49: per-user feature entitlements + model allowlist
--
--  Lets an admin decide, per colleague: which FEATURES they may use on the site,
--  and which Cloud MODELS Claude may run for them. Builds on the existing pattern
--  (profiles.role/status/ai_model/can_workflows/can_figures, is_admin()).
--
--  SAFE-BY-DEFAULT (hardened per the security review):
--   - deny on missing profile row / unknown feature key
--   - server-side helpers are the authoritative gate; frontend hiding is cosmetic
--   - users CANNOT self-grant (no non-admin UPDATE policy on profiles + a self-lock trigger)
--   - the model fallback is the cheapest ALLOWED model, never an env default
--   - closes a live gap: is_active() lets edge fns reject suspended/pending users
--     server-side (today status is only enforced client-side).
--
--  Apply in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

-- ---- 1. columns on profiles -----------------------------------------------
alter table public.profiles add column if not exists features        jsonb   not null default '{}'::jsonb;
alter table public.profiles add column if not exists model_allowlist text[];   -- NULL = all active system models

comment on column public.profiles.features is
  'Admin-set per-user feature grants {"<key>":true|false,...}. Absent key = catalog default. Read server-side by is_feature_enabled().';
comment on column public.profiles.model_allowlist is
  'Admin-set allowed Claude model ids. NULL = all active allowed_models. ai_model must be a member (enforced by trigger).';

-- ---- 2. canonical model set (single source of truth) -----------------------
create table if not exists public.allowed_models (
  model_id text primary key,
  label    text    not null,
  sort     int     not null default 100,   -- ascending = most→least expensive; last active = cheapest fallback
  active   boolean not null default true
);
insert into public.allowed_models(model_id,label,sort) values
  ('claude-opus-4-8',            'Opus 4.8 — best quality',        10),
  ('claude-sonnet-4-6',         'Sonnet 4.6 — balanced',          20),
  ('claude-haiku-4-5-20251001', 'Haiku 4.5 — fastest / cheapest', 30)
on conflict (model_id) do update set label=excluded.label, sort=excluded.sort, active=true;

alter table public.allowed_models enable row level security;
drop policy if exists allowed_models_read  on public.allowed_models;
create policy allowed_models_read  on public.allowed_models for select using (auth.uid() is not null); -- authenticated only
drop policy if exists allowed_models_admin on public.allowed_models;
create policy allowed_models_admin on public.allowed_models for all using (public.is_admin()) with check (public.is_admin());

-- ---- 3. feature catalog (drives admin matrix + default posture) ------------
--  enforced=false => UI-convenience only; nav-hide is cosmetic, NOT a boundary.
--  enforced=true  => backed by a real server-side gate (edge fn / RPC / RLS).
create table if not exists public.feature_catalog (
  key        text    primary key,
  label      text    not null,
  category   text    not null default 'ai',    -- 'ai' | 'page'
  default_on boolean not null default true,
  enforced   boolean not null default false,
  sort       int     not null default 100
);
comment on table public.feature_catalog is
  'Admin-gateable features. enforced=true => server-enforced boundary; false => UI-only convenience (honestly labelled in admin).';

insert into public.feature_catalog (key,label,category,default_on,enforced,sort) values
  ('page_research',        'Research workspace (nav)',        'page', true,  false, 10),
  ('research_chat_ideas',  'Research Chat / Ideas',           'ai',   true,  true,  20),
  ('literature_study',     'Literature Study / Search',       'ai',   true,  true,  30),
  ('protocol_runner',      'Protocol Runner',                 'ai',   false, true,  40),
  ('journal_matching',     'Journal Matching',                'ai',   true,  true,  50),
  ('research_ai_writing',  'Research AI Writing',             'ai',   true,  true,  60),
  ('page_session',         'Publify Chat (Session)',          'ai',   true,  true,  70),
  ('session_workflow_mode','Agentic Workflow Mode',           'ai',   false, true,  80),  -- legacy: can_workflows
  ('ai_writing_assist',    'In-editor AI Writing Assist',     'ai',   true,  true,  90),
  ('paper_figure',         'Paper Figure Gen (PaperBanana)',  'ai',   false, true,  100), -- legacy: can_figures
  ('page_memory',          'Memory Graph',                    'ai',   true,  true,  110),
  ('page_media',           'Media / TTS-Translate',           'ai',   true,  true,  120),
  ('page_submissions',     'Erkezteto (editorial)',           'page', true,  true,  130),
  ('mtmt_sync',            'MTMT Publication Sync',           'ai',   true,  true,  140),
  ('page_compare',         'Version Comparison',              'page', true,  false, 150), -- UI-only
  ('page_phd',             'Doctoral School',                 'page', true,  false, 160), -- UI-only
  ('page_publications',    'Publications browser',            'page', true,  false, 170), -- UI-only
  ('page_kanban',          'My Tasks (Kanban)',               'page', true,  false, 180)  -- UI-only
on conflict (key) do update
  set label=excluded.label, category=excluded.category, default_on=excluded.default_on,
      enforced=excluded.enforced, sort=excluded.sort;

alter table public.feature_catalog enable row level security;
drop policy if exists feature_catalog_read  on public.feature_catalog;
create policy feature_catalog_read  on public.feature_catalog for select using (auth.uid() is not null);
drop policy if exists feature_catalog_admin on public.feature_catalog;
create policy feature_catalog_admin on public.feature_catalog for all using (public.is_admin()) with check (public.is_admin());

-- ---- 4. helpers: SELF-SCOPED to auth.uid(), authenticated-only -------------
--  No caller-supplied uid => no enumeration. Missing row => deny.

-- Active = approved, OR the caller is an admin (admins never self-lock out).
create or replace function public.is_active()
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_admin()
      or coalesce((select status = 'approved' from profiles where id = auth.uid()), false);
$$;

-- Feature enabled for the CALLER. Legacy keys read the existing boolean columns as sole truth.
create or replace function public.is_feature_enabled(p_key text)
returns boolean language sql stable security definer set search_path=public as $$
  select case
    when auth.uid() is null then false
    when not exists (select 1 from profiles where id = auth.uid()) then false   -- missing row = closed
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
      false)                                                                     -- unknown key = closed
  end;
$$;

-- Model allowed for the CALLER: must be an active system model AND (allowlist NULL OR contains it).
create or replace function public.model_allowed(p_model text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from allowed_models where model_id = p_model and active)
     and coalesce(
           (select model_allowlist is null or p_model = any(model_allowlist)
              from profiles where id = auth.uid()),
           false);                                                                -- missing row = closed
$$;

-- The model an edge fn MUST use for the caller. Never the env default.
-- Order: valid active choice → first of user's allowlist → cheapest active system model.
create or replace function public.effective_model()
returns text language sql stable security definer set search_path=public as $$
  with me as (select ai_model, model_allowlist from profiles where id = auth.uid())
  select coalesce(
    (select ai_model from me where public.model_allowed((select ai_model from me))),
    (select model_allowlist[1] from me where model_allowlist is not null),
    (select model_id from allowed_models where active order by sort desc limit 1)  -- cheapest, deterministic
  );
$$;

revoke all on function public.is_active()                 from public, anon;
revoke all on function public.is_feature_enabled(text)    from public, anon;
revoke all on function public.model_allowed(text)         from public, anon;
revoke all on function public.effective_model()           from public, anon;
grant execute on function public.is_active()              to authenticated;
grant execute on function public.is_feature_enabled(text) to authenticated;
grant execute on function public.model_allowed(text)      to authenticated;
grant execute on function public.effective_model()        to authenticated;

-- ---- 5. self-lock trigger (defense-in-depth) -------------------------------
--  Primary guard is the ABSENCE of a non-admin UPDATE policy on profiles
--  (migration-33 lockdown). This locks the new columns on the one SECURITY DEFINER
--  path (invitation-accept) and extends the existing migration-03 role-lock.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if public.is_admin() then return new; end if;   -- admins unrestricted
  new.role            := old.role;
  new.features        := old.features;             -- lock entitlements
  new.model_allowlist := old.model_allowlist;
  new.ai_model        := old.ai_model;
  new.can_workflows   := old.can_workflows;
  new.can_figures     := old.can_figures;
  if new.status is distinct from old.status and new.status <> 'pending' then
    new.status := old.status;
  end if;
  return new;
end; $$;

-- ---- 6. keep ai_model inside the allowlist; evict to first allowed (never env)
create or replace function public.enforce_model_allowlist()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.ai_model is not null and new.model_allowlist is not null
     and not (new.ai_model = any(new.model_allowlist)) then
    new.ai_model := new.model_allowlist[1];   -- first allowed, so effective_model() can't escape to env default
  end if;
  return new;
end; $$;
drop trigger if exists enforce_model_allowlist on public.profiles;
create trigger enforce_model_allowlist before insert or update on public.profiles
  for each row execute function public.enforce_model_allowlist();

-- ---------------------------------------------------------------------------
-- Notes:
--  * No new RLS on profiles is needed: admin_all_profiles (migration-03) already
--    authorizes admin writes to the new columns; migration-33 lets a user read
--    their own row for cosmetic gating; non-admins have NO UPDATE policy, so a
--    self-grant `update profiles set features=...` affects 0 rows.
--  * Edge functions enforce via _shared/entitlement.ts (assertEntitled + resolveModel).
--  * Verify after apply:
--      select count(*) from feature_catalog;              -- expect 18
--      select * from allowed_models;                      -- 3 active
--      select public.is_feature_enabled('protocol_runner');  -- false by default
-- ---------------------------------------------------------------------------
