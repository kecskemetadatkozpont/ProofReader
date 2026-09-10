-- ============================================================================
--  migration-115 — record AI cost for SERVICE-ROLE (cron) calls too.
--
--  Why: ai_cost_log returns early when auth.uid() is null, so every scheduled /
--  service-role path (student-digest's daily batch, any future cron) spends money
--  INVISIBLY. That is exactly the spend nobody can account for afterwards.
--
--  This adds an explicit p_user argument that ONLY the service role may use;
--  authenticated callers keep being pinned to auth.uid() and cannot attribute
--  their spend to somebody else.
--
--  Apply in the Supabase SQL editor (idempotent).
-- ============================================================================

create or replace function public.ai_cost_log(
  p_project uuid, p_fn text, p_model text, p_in int, p_out int, p_user uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare pin numeric; pout numeric; c numeric; uid uuid;
begin
  -- A normal caller is ALWAYS their own auth.uid(); p_user is honoured only for the service role.
  if auth.uid() is not null then
    uid := auth.uid();
  elsif coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     or coalesce((current_setting('request.jwt.claims', true))::jsonb ->> 'role', '') = 'service_role' then
    uid := p_user;
  else
    uid := null;
  end if;
  if uid is null then return; end if;
  if not exists (select 1 from public.profiles where id = uid) then return; end if;   -- FK guard

  select input_usd_per_mtok, output_usd_per_mtok into pin, pout from public.ai_model_prices where model = p_model;
  if pin is null then pin := 3; pout := 15; end if;
  c := (coalesce(p_in,0)::numeric / 1000000.0) * pin + (coalesce(p_out,0)::numeric / 1000000.0) * pout;
  insert into public.ai_cost_events (user_id, project_id, fn, model, input_tokens, output_tokens, cost_usd)
  values (uid, p_project, coalesce(p_fn,'?'), coalesce(p_model,'?'), coalesce(p_in,0), coalesce(p_out,0), c);
end $$;

grant execute on function public.ai_cost_log(uuid, text, text, int, int, uuid) to authenticated, service_role;
