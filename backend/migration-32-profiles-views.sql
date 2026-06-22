-- migration-32 (additive): narrow public projections + a privacy-preserving search, so cross-user name/
-- avatar display keeps working AFTER we restrict the base profiles table (migration-33). Apply this FIRST,
-- deploy the repointed client, THEN apply migration-33. Views run as owner (bypass base RLS) and expose
-- ONLY safe columns.

-- name/avatar for collaboration (members, mentions, shared-by avatars)
create or replace view public.profiles_public as
  select id, name, avatar_url, color, plan from public.profiles;
grant select on public.profiles_public to authenticated;

-- supervisor directory (students browse supervisors) — NO email / MTMT / private PII
create or replace view public.supervisors_public as
  select id, name, avatar_url, department, position, research_interests, capacity_max, accepting_students
  from public.profiles where is_supervisor = true;
grant select on public.supervisors_public to authenticated;

-- collaborator discovery: find a user to invite by name/email WITHOUT exposing emails/PII (returns id/name/avatar only)
create or replace function public.pr_search_users(q text)
returns table (id uuid, name text, avatar_url text)
language sql security definer set search_path = public stable as $$
  select p.id, p.name, p.avatar_url from public.profiles p
  where length(coalesce(trim(q), '')) >= 2
    and (p.name ilike '%' || q || '%' or p.email ilike '%' || q || '%')
  order by p.name limit 8;
$$;
grant execute on function public.pr_search_users(text) to authenticated;
