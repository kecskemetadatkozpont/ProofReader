-- ============================================================================
--  Publify — migration 50: Elicit integration substrate (Phase 0 + 1)
--
--  Prereq: migration-49 (entitlements). Adds the 4 Elicit feature keys to the
--  catalog (so they appear in the admin permission matrix automatically), a
--  GENERALIZED per-user/per-feature daily budget (Elicit meters differently from
--  Anthropic, so it must NOT share ai_usage), and a shared content-keyed search
--  cache so repeated searches don't burn Elicit's shared org rate-limit bucket.
--
--  Apply in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

-- ---- 1. Elicit feature keys (off by default; server-enforced) --------------
insert into public.feature_catalog (key,label,category,default_on,enforced,sort) values
  ('elicit_search',    'Elicit — paper search',       'ai', false, true, 200),
  ('elicit_trials',    'Elicit — clinical trials',    'ai', false, true, 210),
  ('elicit_reports',   'Elicit — automated reports',  'ai', false, true, 220),
  ('elicit_sysreview', 'Elicit — systematic reviews', 'ai', false, true, 230)
on conflict (key) do update
  set label=excluded.label, category=excluded.category, default_on=excluded.default_on,
      enforced=excluded.enforced, sort=excluded.sort;

-- ---- 2. generalized per-user / per-feature daily budget --------------------
--  Mirrors migration-48's ai_usage shape, keyed by an arbitrary feature_key, so
--  Elicit search / reports / SR each get their own per-user daily fairness cap,
--  independent of the Anthropic ai_usage counter and of Elicit's org quota.
create table if not exists public.feature_usage (
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  feature_key text not null,
  day         date not null default current_date,
  calls       int  not null default 0,
  primary key (user_id, feature_key, day)
);
create index if not exists feature_usage_day_idx on public.feature_usage(day);

alter table public.feature_usage enable row level security;
drop policy if exists feature_usage_own on public.feature_usage;
create policy feature_usage_own on public.feature_usage for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- true once the caller has already used >= max_calls of this feature today
create or replace function public.feature_over_budget(p_key text, max_calls int)
returns boolean language sql security invoker set search_path = public as $$
  select coalesce((select calls from feature_usage
                     where user_id = auth.uid() and feature_key = p_key and day = current_date), 0) >= max_calls;
$$;

-- increment today's counter for this feature for the caller (call after a successful use)
create or replace function public.feature_usage_bump(p_key text)
returns void language sql security invoker set search_path = public as $$
  insert into feature_usage (user_id, feature_key, day, calls) values (auth.uid(), p_key, current_date, 1)
  on conflict (user_id, feature_key, day) do update set calls = feature_usage.calls + 1;
$$;

grant select, insert, update on table public.feature_usage to authenticated;
grant execute on function public.feature_over_budget(text,int) to authenticated;
grant execute on function public.feature_usage_bump(text)      to authenticated;

-- ---- 3. shared search cache (protects the org rate-limit bucket) -----------
--  Content-keyed (query + mode + corpus + filters) cache of PUBLIC paper
--  metadata → safe to share across users. A cache hit does NOT bump
--  feature_usage (so cached searches are intentionally free). Rows are pruned
--  by fetched_at (24h TTL) in the edge function.
create table if not exists public.elicit_search_cache (
  query_hash  text primary key,
  query       text,
  corpus      text,
  search_mode text,
  filters     jsonb,
  results     jsonb not null default '[]'::jsonb,
  ratelimit   jsonb,
  fetched_at  timestamptz not null default now()
);
create index if not exists elicit_search_cache_fetched_idx on public.elicit_search_cache(fetched_at);

alter table public.elicit_search_cache enable row level security;
drop policy if exists elicit_cache_rw on public.elicit_search_cache;
create policy elicit_cache_rw on public.elicit_search_cache for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Secrets the research-study edge function reads (set via `supabase secrets set`):
--   ELICIT_API_KEY       elk_live_...   (required; Pro plan+; without it the
--                                        adapter gracefully falls back to OpenAlex)
--   ELICIT_SEARCH_DAILY  per-user daily Elicit-search cap (default 50)
--   ELICIT_API_BASE      override (default https://elicit.com)
--
-- Verify after apply:
--   select key from feature_catalog where key like 'elicit_%';   -- 4 rows
--   select public.feature_over_budget('elicit_search', 50);      -- false initially
-- ---------------------------------------------------------------------------
