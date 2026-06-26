-- migration-41: opt-in public sharing of a saved comparison (read-only link for reviewers)
-- The owner flips a project public; a random share_token + a long-lived signed URL to the package zip are stored.
-- Anonymous visitors read the project ONLY through a SECURITY DEFINER RPC that matches the token AND is_public
-- (no broad "list all public" RLS hole), then fetch the zip via the signed URL (no Storage RLS needed).

alter table public.compare_projects add column if not exists is_public      boolean not null default false;
alter table public.compare_projects add column if not exists share_token    text;
alter table public.compare_projects add column if not exists zip_public_url text;
alter table public.compare_projects add column if not exists shared_at      timestamptz;
create unique index if not exists compare_projects_share_token_idx
  on public.compare_projects(share_token) where share_token is not null;

-- anon-callable read by token; bypasses RLS but only returns a row that is explicitly public + token-matched
create or replace function public.compare_shared(p_token text)
returns table (
  id uuid, title text, publication jsonb, stats jsonb, reviewer_text text,
  zip_public_url text, file_count int, size_bytes bigint, created_at timestamptz
)
language sql security definer stable
set search_path = public
as $$
  select id, title, publication, stats, reviewer_text, zip_public_url, file_count, size_bytes, created_at
  from public.compare_projects
  where share_token = p_token and is_public = true
  limit 1;
$$;
revoke all on function public.compare_shared(text) from public;
grant execute on function public.compare_shared(text) to anon, authenticated;
