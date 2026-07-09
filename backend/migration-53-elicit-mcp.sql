-- ============================================================================
--  Publify — migration 53: Elicit MCP (org-level OAuth connection)
--
--  Phase 4. An admin connects the org's Elicit account ONCE via OAuth 2.0
--  (authorization_code + PKCE, dynamic client registration). The token lets
--  claude-session (Publify Chat, workflow mode) expose Elicit's MCP tools to
--  Claude via Anthropic's MCP connector, for users granted `elicit_mcp`.
--
--  SECURITY: the OAuth tokens live in a SERVICE-ROLE-ONLY table (no RLS policy
--  for `authenticated`, so PostgREST/users can never read them). Admins see only
--  a status (connected? expiry) via a SECURITY DEFINER function. The edge
--  functions (elicit-oauth, claude-session) read/write the tokens with the
--  service role.
--
--  Apply in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

-- ---- 1. feature key (off by default; server-enforced in claude-session) ----
insert into public.feature_catalog (key,label,category,default_on,enforced,sort) values
  ('elicit_mcp', 'Elicit tools in Chat (MCP)', 'ai', false, true, 240)
on conflict (key) do update
  set label=excluded.label, category=excluded.category, default_on=excluded.default_on,
      enforced=excluded.enforced, sort=excluded.sort;

-- ---- 2. singleton org connection (SERVICE-ROLE ONLY) ------------------------
create table if not exists public.elicit_mcp_org (
  id            int primary key default 1 check (id = 1),
  client_id     text,                    -- dynamically-registered OAuth client
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  scope         text,
  connected_by  uuid,
  connected_at  timestamptz,
  updated_at    timestamptz not null default now()
);
insert into public.elicit_mcp_org (id) values (1) on conflict (id) do nothing;
alter table public.elicit_mcp_org enable row level security;   -- NO authenticated policy → only service_role reaches the tokens

-- ---- 3. pending OAuth flows (SERVICE-ROLE ONLY) -----------------------------
create table if not exists public.elicit_mcp_pending (
  state         text primary key,
  code_verifier text not null,
  client_id     text,
  redirect_uri  text,
  admin_id      uuid,
  created_at    timestamptz not null default now()
);
alter table public.elicit_mcp_pending enable row level security;

-- ---- 4. admin-visible STATUS (no token) ------------------------------------
create or replace function public.elicit_mcp_status()
returns table(connected boolean, expires_at timestamptz, connected_by uuid, connected_at timestamptz)
language sql stable security definer set search_path = public as $$
  select (o.access_token is not null) as connected, o.expires_at, o.connected_by, o.connected_at
  from elicit_mcp_org o where o.id = 1 and public.is_admin();
$$;
revoke all on function public.elicit_mcp_status() from public, anon;
grant execute on function public.elicit_mcp_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Secrets the elicit-oauth / claude-session functions use:
--   (none new — they read/write elicit_mcp_org with the service role)
-- The OAuth redirect URI (registered dynamically) is the elicit-oauth function URL:
--   https://jokqthwszkweyqmmdesn.supabase.co/functions/v1/elicit-oauth
-- Deploy elicit-oauth with --no-verify-jwt (the OAuth callback is an unauthenticated
-- browser redirect; admin actions authenticate in-code via getUser + is_admin).
-- ---------------------------------------------------------------------------
