-- ============================================================================
--  Aloud — migration 03:  registration, approval gate, roles & admin
--  Run once in the Supabase SQL Editor (safe to re-run).
--
--  Adds to profiles: role (user|admin), status (incomplete|pending|approved|
--  rejected|suspended), affiliation, mtmt_id, orcid, position, last_active_at.
--  New users land as 'incomplete' → fill the onboarding form → 'pending' →
--  an admin approves/rejects. The admin account is auto-provisioned & approved.
--  Adds is_admin(), a guard so users can't self-approve, and admin RLS.
-- ============================================================================

-- ---- 1. profile columns ----------------------------------------------------
alter table profiles add column if not exists role           text not null default 'user';
alter table profiles add column if not exists status         text not null default 'incomplete';
alter table profiles add column if not exists affiliation    text;
alter table profiles add column if not exists mtmt_id        text;
alter table profiles add column if not exists orcid          text;
alter table profiles add column if not exists position       text;
alter table profiles add column if not exists last_active_at timestamptz;

-- ---- 2. designate the admin ------------------------------------------------
update profiles set role = 'admin', status = 'approved'
where lower(email) = 'kecskemet.adatkozpont@gmail.com';

-- ---- 3. sign-up trigger sets role/status (admin auto-approved) --------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare adm boolean := lower(coalesce(new.email,'')) = 'kecskemet.adatkozpont@gmail.com';
begin
  insert into public.profiles (id, email, name, avatar_url, role, status)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name',
                   new.raw_user_meta_data->>'name',
                   split_part(coalesce(new.email,''),'@',1)),
          new.raw_user_meta_data->>'avatar_url',
          case when adm then 'admin' else 'user' end,
          case when adm then 'approved' else 'incomplete' end)
  on conflict (id) do nothing;
  return new;
exception when others then
  raise warning 'handle_new_user failed for %: %', new.id, sqlerrm; return new;
end; $$;

-- ---- 4. is_admin() helper --------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- ---- 5. guard: non-admins cannot self-approve or change their role ---------
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;     -- admins may do anything
  new.role := old.role;                             -- never let a user change role
  -- a user may only move their own status to 'pending' (submit onboarding)
  if new.status is distinct from old.status and new.status <> 'pending' then
    new.status := old.status;
  end if;
  return new;
end; $$;

drop trigger if exists guard_profile_update on profiles;
create trigger guard_profile_update before update on profiles
  for each row execute function public.guard_profile_update();

-- ---- 6. admin RLS (permissive, OR-ed with the existing per-user policies) ---
drop policy if exists admin_all_profiles on profiles;
create policy admin_all_profiles on profiles for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists admin_all_projects on projects;
create policy admin_all_projects on projects for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists admin_read_usage on usage_meters;
create policy admin_read_usage on usage_meters for select using (public.is_admin());

drop policy if exists admin_read_members on project_members;
create policy admin_read_members on project_members for select using (public.is_admin());

-- ============================================================================
--  Done. The admin opens Admin.html (admin-only). New users now pass through
--  onboarding + a pending-approval gate before they can use the editor.
-- ============================================================================
