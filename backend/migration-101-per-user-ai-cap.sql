-- ============================================================================
--  Publify — migration 101: per-user configurable daily AI cap.
--
--  migration-48 gave a per-user daily COUNTER (ai_usage) enforced against a
--  GLOBAL cap (the AI_DAILY_CALLS env, default 200). This makes the cap
--  PER-USER configurable: an admin can raise a power-user's cap or throttle an
--  abuser via profiles.ai_daily_cap. NULL = use the global default.
--
--  ai_over_budget() now honors the caller's own cap. It is SECURITY INVOKER, so
--  it reads profiles under the caller's JWT — profiles RLS already permits a user
--  to read their OWN row (migrations 31/32/33), so this needs no policy change.
--
--  Idempotent; run in the SQL editor. Requires migration-48.
-- ============================================================================

alter table public.profiles add column if not exists ai_daily_cap int;
comment on column public.profiles.ai_daily_cap is
  'Per-user daily AI-request cap. NULL = global default (AI_DAILY_CALLS env, 200). Admin-settable.';

-- Honor the per-user cap; fall back to the caller-supplied max_calls (env default) when NULL.
create or replace function public.ai_over_budget(max_calls int)
returns boolean language sql security invoker set search_path = public as $$
  select coalesce((select calls from ai_usage where user_id = auth.uid() and day = current_date), 0)
       >= coalesce((select ai_daily_cap from public.profiles where id = auth.uid()), max_calls);
$$;

grant execute on function public.ai_over_budget(int) to authenticated;
