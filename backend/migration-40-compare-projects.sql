-- migration-40: saved revision-comparison packages (Verzió-összehasonlítás)
-- A whole P1_review_compare folder is zipped client-side and stored as one object in the private
-- `compare` bucket at {owner}/{id}/package.zip; the row holds queryable metadata for the saved list.
-- Owner-only RLS on both the table and the bucket (uid-prefix), mirroring migration-39 (audiobooks).

create table if not exists public.compare_projects (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'Összehasonlítás',
  publication jsonb,
  stats       jsonb,
  file_count  int    default 0,
  size_bytes  bigint default 0,
  zip_path    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists compare_projects_owner_idx on public.compare_projects(owner, created_at desc);

alter table public.compare_projects enable row level security;
drop policy if exists cp_sel on public.compare_projects;
create policy cp_sel on public.compare_projects for select using (owner = auth.uid());
drop policy if exists cp_ins on public.compare_projects;
create policy cp_ins on public.compare_projects for insert with check (owner = auth.uid());
drop policy if exists cp_upd on public.compare_projects;
create policy cp_upd on public.compare_projects for update using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists cp_del on public.compare_projects;
create policy cp_del on public.compare_projects for delete using (owner = auth.uid());

-- private storage bucket for the zipped packages
insert into storage.buckets (id, name, public) values ('compare', 'compare', false)
  on conflict (id) do nothing;

drop policy if exists cmp_obj_sel on storage.objects;
create policy cmp_obj_sel on storage.objects for select
  using (bucket_id = 'compare' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists cmp_obj_ins on storage.objects;
create policy cmp_obj_ins on storage.objects for insert
  with check (bucket_id = 'compare' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists cmp_obj_upd on storage.objects;
create policy cmp_obj_upd on storage.objects for update
  using (bucket_id = 'compare' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists cmp_obj_del on storage.objects;
create policy cmp_obj_del on storage.objects for delete
  using (bucket_id = 'compare' and (storage.foldername(name))[1] = auth.uid()::text);
