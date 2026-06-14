-- ============================================================================
--  ProofReader — migration 02:  fix "Database error saving new user"
--  Run this once in the Supabase SQL Editor (safe to re-run).
--
--  Cause: the sign-up trigger handle_new_user() copies the Google profile into
--  public.profiles, but as a SECURITY DEFINER function without a fixed
--  search_path it could not resolve the unqualified `profiles` table, so it
--  raised — and GoTrue rolls back the whole auth.users insert, which surfaces
--  to the user as "Database error saving new user".
--
--  Fix: pin search_path, schema-qualify the table, grant GoTrue's admin role
--  what it needs, and make the trigger non-fatal so a profile hiccup can never
--  block account creation. Plus an INSERT policy so the app can self-heal its
--  own profile row if it is ever missing.
-- ============================================================================

-- GoTrue runs the insert as supabase_auth_admin; make sure it can reach + write.
grant usage on schema public to supabase_auth_admin;
grant select, insert, update on public.profiles to supabase_auth_admin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (new.id,
          new.email,
          coalesce(new.raw_user_meta_data->>'full_name',
                   new.raw_user_meta_data->>'name',
                   split_part(coalesce(new.email,''),'@',1)),
          new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
exception when others then
  -- Never block sign-up because of a profile hiccup; the app self-heals.
  raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Let a signed-in user create their OWN profile row (self-heal fallback).
-- (read_profiles + write_own_profile already cover select + update.)
drop policy if exists insert_own_profile on profiles;
create policy insert_own_profile on profiles
  for insert with check (id = auth.uid());

-- Backfill: create profiles for any auth users that slipped through earlier.
insert into public.profiles (id, email, name, avatar_url)
select u.id, u.email,
       coalesce(u.raw_user_meta_data->>'full_name',
                u.raw_user_meta_data->>'name',
                split_part(coalesce(u.email,''),'@',1)),
       u.raw_user_meta_data->>'avatar_url'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;
