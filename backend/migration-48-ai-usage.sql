-- ============================================================================
--  Publify — migration 48: per-user daily AI budget.
--
--  P0 cost control: the edge functions had NO per-user rate/budget limit, so one
--  user could trigger unlimited paid Anthropic calls. This adds a tiny per-user /
--  per-day call counter + two helper functions the functions call:
--    ai_over_budget(max_calls) → true once the user has made >= max_calls today
--    ai_usage_bump()           → increments today's counter (called after a call)
--  Both run as SECURITY INVOKER under the caller's JWT, so auth.uid() is the user.
--
--  The edge functions treat a missing RPC as "not over budget" (graceful no-op),
--  so this migration can be applied before/after redeploying them without breakage.
--
--  Apply in the Supabase SQL Editor. Idempotent. Tune the cap per function via the
--  AI_DAILY_CALLS secret (default 200).
-- ============================================================================

create table if not exists ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  day     date not null default current_date,
  calls   int  not null default 0,
  primary key (user_id, day)
);
create index if not exists ai_usage_day_idx on ai_usage(day);

alter table ai_usage enable row level security;
drop policy if exists ai_usage_own on ai_usage;
create policy ai_usage_own on ai_usage for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- true once the caller has already used >= max_calls today
create or replace function public.ai_over_budget(max_calls int)
returns boolean language sql security invoker set search_path = public as $$
  select coalesce((select calls from ai_usage where user_id = auth.uid() and day = current_date), 0) >= max_calls;
$$;

-- increment today's counter for the caller (call after a successful AI call)
create or replace function public.ai_usage_bump()
returns void language sql security invoker set search_path = public as $$
  insert into ai_usage (user_id, day, calls) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set calls = ai_usage.calls + 1;
$$;

grant execute on function public.ai_over_budget(int) to authenticated;
grant execute on function public.ai_usage_bump() to authenticated;

-- ---------------------------------------------------------------------------
-- To extend the cap to the other AI edge functions, add these two lines to each
-- (research-ai, research-protocol, research-study, research-journals, text-assist,
--  submission-ops, claude-session, paper-figure) — right after the getUser() gate:
--
--   const { data: over } = await sb.rpc('ai_over_budget', { max_calls: parseInt(Deno.env.get('AI_DAILY_CALLS')||'200',10) });
--   if (over === true) return json({ error: 'Daily AI limit reached — try again tomorrow.' }, 429);
--
-- and `sb.rpc('ai_usage_bump');` right after each successful Claude call.
-- (research-writing + tts-translate already wired.)
-- ---------------------------------------------------------------------------
