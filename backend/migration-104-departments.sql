-- migration-104-departments.sql
-- Cost center / Department is now a USER-COLLECTED list — the old fixed cost-centers.js list is retired.
-- pr_departments() returns the DISTINCT department / cost-center values users have already registered
-- (aggregated from profiles.cost_center), so the onboarding autocomplete can offer them + let a user add a new one.
-- SECURITY DEFINER so it can aggregate across ALL profiles despite the own-row RLS on public.profiles;
-- it exposes ONLY the free-text department names (no other profile data), so it leaks nothing sensitive.
create or replace function public.pr_departments()
returns table(name text)
language sql
security definer
stable
set search_path = public
as $$
  select distinct trim(both from cost_center) as name
  from public.profiles
  where cost_center is not null and length(trim(both from cost_center)) > 0
  order by 1;
$$;

revoke all on function public.pr_departments() from public;
grant execute on function public.pr_departments() to authenticated;

-- verify:
--   select * from public.pr_departments();   -- the distinct department/cost-center list users have registered
