-- ============================================================================
--  Publify — migration 04: researcher publications, per-paper files, user prefs
--  Run in the Supabase SQL editor (DDL). Profiles already carry mtmt_id / orcid /
--  affiliation (migration-03); this adds the publication graph + a prefs store and
--  moves the bundled MTMT data + browser-local prefs into Postgres / Storage.
--  Idempotent (create ... if not exists / drop policy if exists).
-- ============================================================================

-- ---- 0. self-contained prerequisites (in case migration-03 was not applied) -
-- columns the researcher seed writes (idempotent; no-op if migration-03 already added them)
alter table profiles add column if not exists role           text not null default 'user';
alter table profiles add column if not exists status         text not null default 'incomplete';
alter table profiles add column if not exists affiliation    text;
alter table profiles add column if not exists mtmt_id        text;
alter table profiles add column if not exists orcid          text;
alter table profiles add column if not exists position       text;
alter table profiles add column if not exists last_active_at timestamptz;

-- admin predicate used by the RLS policies below (matches migration-03's definition)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---- 1. profiles: flag researcher accounts ---------------------------------
alter table profiles add column if not exists is_researcher boolean not null default false;

-- ---- 2. publications -------------------------------------------------------
create table if not exists publications (
  id              uuid primary key default gen_random_uuid(),
  researcher_id   uuid not null references profiles(id) on delete cascade,
  mtid            bigint,                              -- MTMT publication id
  type            text,                                -- JournalArticle, …
  type_hu         text,                                -- Folyóiratcikk, …
  title           text,
  year            int,
  first_author    text,
  author_count    int,
  journal         text,
  volume          text,
  issue           text,
  pages           text,
  doi             text,
  citations       int default 0,
  indep_citations int default 0,
  oa_type         text,
  category        text,
  core            boolean,
  citation        text,                                -- formatted MTMT citation
  mtmt_url        text,
  raw             jsonb,                               -- full source record (future-proof)
  created_at      timestamptz not null default now(),
  unique (researcher_id, mtid)
);
create index if not exists publications_researcher_idx on publications(researcher_id);
create index if not exists publications_year_idx on publications(researcher_id, year desc);

-- ---- 3. publication_files (metadata; blobs live in Storage) -----------------
create table if not exists publication_files (
  id             uuid primary key default gen_random_uuid(),
  publication_id uuid not null references publications(id) on delete cascade,
  owner_id       uuid not null references profiles(id) on delete cascade,
  name           text not null,
  mime           text,
  size           bigint not null default 0,
  storage_path   text not null,                        -- <owner_id>/<publication_id>/<file_id>
  created_at     timestamptz not null default now()
);
create index if not exists publication_files_pub_idx on publication_files(publication_id);
create index if not exists publication_files_owner_idx on publication_files(owner_id);

-- ---- 4. prefs (was browser localStorage: voice / spell / pronunciation …) ---
create table if not exists prefs (
  user_id    uuid primary key references profiles(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---- 5. row-level security -------------------------------------------------
alter table publications      enable row level security;
alter table publication_files enable row level security;
alter table prefs             enable row level security;

-- publications: world-readable to signed-in users (public bibliographic data);
-- only the researcher (or an admin) may write their own list.
drop policy if exists pub_read on publications;
create policy pub_read on publications for select to authenticated using (true);
drop policy if exists pub_write on publications;
create policy pub_write on publications for all to authenticated
  using  (researcher_id = auth.uid() or is_admin())
  with check (researcher_id = auth.uid() or is_admin());

-- publication_files: a researcher manages only their own attachments (admin: all).
drop policy if exists pubfile_owner on publication_files;
create policy pubfile_owner on publication_files for all to authenticated
  using  (owner_id = auth.uid() or is_admin())
  with check (owner_id = auth.uid() or is_admin());

-- prefs: each user reads/writes only their own row.
drop policy if exists prefs_owner on prefs;
create policy prefs_owner on prefs for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---- 6. Storage bucket for publication files -------------------------------
insert into storage.buckets (id, name, public)
values ('publication-files', 'publication-files', false)
on conflict (id) do nothing;

-- object path convention: "<owner_id>/<publication_id>/<file_id>" — first segment is the owner.
drop policy if exists pubfiles_obj_rw on storage.objects;
create policy pubfiles_obj_rw on storage.objects for all to authenticated
  using  (bucket_id = 'publication-files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'publication-files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists pubfiles_obj_admin_read on storage.objects;
create policy pubfiles_obj_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'publication-files' and is_admin());

-- ============================================================================
--  After this runs: seed the 9 researchers + 448 publications and create their
--  Auth users (email + password) with the service-role key — see seed-publify.mjs.
-- ============================================================================
