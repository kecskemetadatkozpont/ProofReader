-- ============================================================================
--  Publify — migration 113: real-time per-user + per-project AI token/cost tracking + admin reporting.
--
--  migration-48/101 gave a per-user daily CALL counter (ai_usage). This adds true
--  token accounting with a USD price per model, per project, per edge function:
--    ai_model_prices  — editable $/1M-token price per model (admin-settable)
--    ai_cost_events   — one row per AI call: user, project, fn, model, in/out tokens, computed cost
--    ai_cost_log()    — SECURITY DEFINER; every AI edge calls it (under the caller's JWT) to record a call
--    ai_cost_by_user / ai_cost_by_project / ai_cost_summary — is_admin()-gated aggregate reports
--
--  Idempotent; run in the Supabase SQL editor. Requires is_admin() (migrations 31/49/101).
-- ============================================================================

-- ---- editable price table ($ per 1,000,000 tokens) --------------------------
create table if not exists public.ai_model_prices (
  model               text primary key,
  input_usd_per_mtok  numeric not null default 3,
  output_usd_per_mtok numeric not null default 15,
  updated_at          timestamptz not null default now()
);
insert into public.ai_model_prices (model, input_usd_per_mtok, output_usd_per_mtok) values
  ('claude-opus-4-8',            15,   75),
  ('claude-sonnet-4-6',           3,   15),
  ('claude-haiku-4-5-20251001', 0.80,   4),
  ('claude-fable-5',              1,    5)
on conflict (model) do nothing;

-- ---- per-call cost events ---------------------------------------------------
create table if not exists public.ai_cost_events (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  project_id    uuid references public.research_projects(id) on delete set null,
  fn            text not null,
  model         text not null,
  input_tokens  int  not null default 0,
  output_tokens int  not null default 0,
  cost_usd      numeric not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists ai_cost_events_user_idx    on public.ai_cost_events(user_id, created_at desc);
create index if not exists ai_cost_events_project_idx on public.ai_cost_events(project_id, created_at desc);
create index if not exists ai_cost_events_created_idx on public.ai_cost_events(created_at desc);

alter table public.ai_cost_events enable row level security;
drop policy if exists ai_cost_read on public.ai_cost_events;
create policy ai_cost_read on public.ai_cost_events for select to authenticated
  using (user_id = auth.uid() or public.is_admin());   -- inserts are RPC-only (SECURITY DEFINER below)

alter table public.ai_model_prices enable row level security;
drop policy if exists ai_prices_read on public.ai_model_prices;
create policy ai_prices_read  on public.ai_model_prices for select to authenticated using (true);
drop policy if exists ai_prices_admin on public.ai_model_prices;
create policy ai_prices_admin on public.ai_model_prices for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- record one AI call (called by every AI edge). Pins user_id = auth.uid() → a user can only log their OWN usage.
create or replace function public.ai_cost_log(p_project uuid, p_fn text, p_model text, p_in int, p_out int)
returns void language plpgsql security definer set search_path = public as $$
declare pin numeric; pout numeric; c numeric;
begin
  if auth.uid() is null then return; end if;
  select input_usd_per_mtok, output_usd_per_mtok into pin, pout from public.ai_model_prices where model = p_model;
  if pin is null then pin := 3; pout := 15; end if;   -- unknown model → sonnet-ish default (still recorded)
  c := (coalesce(p_in,0)::numeric / 1000000.0) * pin + (coalesce(p_out,0)::numeric / 1000000.0) * pout;
  insert into public.ai_cost_events (user_id, project_id, fn, model, input_tokens, output_tokens, cost_usd)
  values (auth.uid(), p_project, coalesce(p_fn,'?'), coalesce(p_model,'?'), coalesce(p_in,0), coalesce(p_out,0), c);
end $$;
grant execute on function public.ai_cost_log(uuid, text, text, int, int) to authenticated;

-- ---- admin aggregate reports (empty for non-admins) -------------------------
create or replace function public.ai_cost_by_user(p_from timestamptz, p_to timestamptz)
returns table(user_id uuid, email text, name text, calls bigint, input_tokens bigint, output_tokens bigint, cost_usd numeric)
language sql security definer set search_path = public as $$
  select e.user_id, p.email, p.name, count(*)::bigint, coalesce(sum(e.input_tokens),0)::bigint, coalesce(sum(e.output_tokens),0)::bigint, round(coalesce(sum(e.cost_usd),0),4)
  from public.ai_cost_events e left join public.profiles p on p.id = e.user_id
  where public.is_admin() and e.created_at >= p_from and e.created_at < p_to
  group by e.user_id, p.email, p.name
  order by round(coalesce(sum(e.cost_usd),0),4) desc;
$$;
grant execute on function public.ai_cost_by_user(timestamptz, timestamptz) to authenticated;

create or replace function public.ai_cost_by_project(p_from timestamptz, p_to timestamptz)
returns table(project_id uuid, title text, owner_email text, calls bigint, input_tokens bigint, output_tokens bigint, cost_usd numeric)
language sql security definer set search_path = public as $$
  select e.project_id, pr.title, po.email, count(*)::bigint, coalesce(sum(e.input_tokens),0)::bigint, coalesce(sum(e.output_tokens),0)::bigint, round(coalesce(sum(e.cost_usd),0),4)
  from public.ai_cost_events e
  left join public.research_projects pr on pr.id = e.project_id
  left join public.profiles po on po.id = pr.owner_id
  where public.is_admin() and e.created_at >= p_from and e.created_at < p_to
  group by e.project_id, pr.title, po.email
  order by round(coalesce(sum(e.cost_usd),0),4) desc;
$$;
grant execute on function public.ai_cost_by_project(timestamptz, timestamptz) to authenticated;

create or replace function public.ai_cost_summary(p_from timestamptz, p_to timestamptz)
returns jsonb language sql security definer set search_path = public as $$
  select case when not public.is_admin() then '{}'::jsonb else jsonb_build_object(
    'total', (select jsonb_build_object('calls',count(*),'input',coalesce(sum(input_tokens),0),'output',coalesce(sum(output_tokens),0),'cost',round(coalesce(sum(cost_usd),0),4))
              from public.ai_cost_events where created_at >= p_from and created_at < p_to),
    'by_fn', (select coalesce(jsonb_agg(x),'[]'::jsonb) from (
              select fn, count(*) calls, round(sum(cost_usd),4) cost from public.ai_cost_events
              where created_at >= p_from and created_at < p_to group by fn order by sum(cost_usd) desc) x),
    'by_day', (select coalesce(jsonb_agg(x order by (x->>'day')),'[]'::jsonb) from (
              select jsonb_build_object('day',created_at::date,'cost',round(sum(cost_usd),4),'calls',count(*)) x
              from public.ai_cost_events where created_at >= p_from and created_at < p_to group by created_at::date) x)
  ) end;
$$;
grant execute on function public.ai_cost_summary(timestamptz, timestamptz) to authenticated;
