-- ============================================================================
--  ProofReader — Backend schema  (Phase 1: Foundation)
--  Target: Supabase (Postgres 15+).  Paste this whole file into the Supabase
--  SQL Editor and run it once on a fresh project.  Safe to re-run: it uses
--  "if not exists" / "or replace" where possible.
--
--  Sections:
--    1. Profiles (mirror of auth.users)               §3 of the plan
--    2. Core tables (projects, files, members)         §4
--    3. History / annotations / activity / reading     §4
--    4. Usage metering + plan limits + cost control     §11
--    5. Global TTS cache (generate once, reuse for all) §11
--    6. Membership helper + Row-Level Security policies §5
--    7. Storage bucket policies                         §6
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PROFILES  — public, 1:1 with an auth user; auto-provisioned on sign-in
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  name        text,
  avatar_url  text,
  color       text not null default '#4f46e5',   -- presence cursor color
  plan        text not null default 'free',       -- free | pro
  created_at  timestamptz not null default now()
);

-- Copy the Google profile into our table the first time a user appears.
create or replace function handle_new_user()
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
  raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;

-- GoTrue performs the auth.users insert as supabase_auth_admin.
grant usage on schema public to supabase_auth_admin;
grant select, insert, update on public.profiles to supabase_auth_admin;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ----------------------------------------------------------------------------
-- 2. CORE TABLES
-- ----------------------------------------------------------------------------
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references profiles(id) on delete cascade,
  title       text not null default 'Untitled project',
  active_file text,
  file_order  jsonb not null default '[]'::jsonb,
  folders     jsonb not null default '[]'::jsonb,
  link        jsonb not null default '{"enabled":false,"role":"viewer"}'::jsonb,
  deleted_at  timestamptz,                         -- soft delete (§7)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists projects_owner_idx on projects(owner_id);
create index if not exists projects_live_idx  on projects(updated_at) where deleted_at is null;

-- Each .tex / .bib file lives here. Binary uploads (images, PDFs) go to the
-- Storage bucket and are referenced by storage_path instead of inline content.
create table if not exists files (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  path         text not null,                      -- e.g. 'main.tex'
  type         text not null,                      -- tex | bib | image | pdf
  content      text,                               -- text files only
  storage_path text,                               -- binary files → bucket
  updated_at   timestamptz not null default now(),
  unique (project_id, path)
);
create index if not exists files_project_idx on files(project_id);

create table if not exists project_members (
  project_id uuid references projects(id) on delete cascade,
  user_id    uuid references profiles(id) on delete cascade,
  role       text not null,                        -- editor | commenter | viewer
  invited_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists members_user_idx on project_members(user_id);

-- ----------------------------------------------------------------------------
-- 3. HISTORY / ANNOTATIONS / ACTIVITY / READING
-- ----------------------------------------------------------------------------
create table if not exists versions (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  label      text,
  named      boolean not null default false,
  author_id  uuid references profiles(id),
  files      jsonb not null,                       -- snapshot of text files
  created_at timestamptz not null default now()
);
create index if not exists versions_project_idx on versions(project_id, created_at desc);

create table if not exists annotations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  file        text,
  kind        text not null default 'comment',     -- comment | todo
  anchor      jsonb,                               -- { start, end, quote }
  body        text,
  author_id   uuid references profiles(id),
  status      text not null default 'open',
  assignee_id uuid references profiles(id),
  due         date,
  replies     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists annotations_project_idx on annotations(project_id);

create table if not exists activity (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  actor_id   uuid references profiles(id),
  verb       text,
  target     text,
  at         timestamptz not null default now()
);
create index if not exists activity_project_idx on activity(project_id, at desc);

create table if not exists reading_sessions (
  user_id    uuid references profiles(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  idx        int not null default 0,
  at         timestamptz not null default now(),
  primary key (user_id, project_id)
);

-- ----------------------------------------------------------------------------
-- 4. USAGE METERING + PLAN LIMITS  (cost control, §11)
-- ----------------------------------------------------------------------------
create table if not exists usage_meters (
  user_id       uuid references profiles(id) on delete cascade,
  period        text,                              -- 'YYYY-MM'
  storage_bytes bigint not null default 0,
  tts_chars     bigint not null default 0,
  tts_requests  int    not null default 0,
  primary key (user_id, period)
);

create table if not exists plan_limits (
  plan            text primary key,
  storage_bytes   bigint,
  tts_chars_month bigint
);
insert into plan_limits values
  ('free', 50  * 1024 * 1024,  10000),
  ('pro',  1024 * 1024 * 1024, 200000)
on conflict (plan) do update
  set storage_bytes = excluded.storage_bytes,
      tts_chars_month = excluded.tts_chars_month;

-- Atomically check the caller's monthly voice budget AND record the spend.
-- Returns false (without recording) if the charge would exceed the cap.
-- Called by the TTS Edge Function only on a real cache MISS.
create or replace function charge_tts(n int) returns boolean as $$
declare cap bigint; used bigint; p text; per text := to_char(now(),'YYYY-MM');
begin
  select plan into p from profiles where id = auth.uid();
  select tts_chars_month into cap from plan_limits where plan = coalesce(p,'free');
  insert into usage_meters(user_id, period) values (auth.uid(), per)
    on conflict (user_id, period) do nothing;
  select tts_chars into used from usage_meters where user_id = auth.uid() and period = per;
  if used + n > cap then
    return false;                                  -- over budget → deny
  end if;
  update usage_meters
    set tts_chars = tts_chars + n, tts_requests = tts_requests + 1
    where user_id = auth.uid() and period = per;
  return true;
end;
$$ language plpgsql security definer;

-- ----------------------------------------------------------------------------
-- 5. GLOBAL TTS CACHE  (generate once, reuse for ALL users — §11)
--    Key = sha256(text + voice + settings). Deliberately NOT per-user/project,
--    so identical text is ever synthesized at most once.
-- ----------------------------------------------------------------------------
create table if not exists tts_cache (
  hash        text primary key,                    -- sha256(text+voice+settings)
  bytes       int    not null default 0,
  hits        int    not null default 0,           -- times reused (cost avoided)
  created_at  timestamptz not null default now(),
  last_used   timestamptz not null default now()
);
create index if not exists tts_cache_lru_idx on tts_cache(last_used);

-- Record a fresh synthesis (cache miss → first & only generation).
create or replace function register_cache(h text, b int) returns void as $$
  insert into tts_cache(hash, bytes) values (h, b)
  on conflict (hash) do update set last_used = now();
$$ language sql security definer;

-- Record a reuse (cache hit → no API call, no charge). Drives the
-- "spend avoided" stat and keeps last_used fresh for LRU eviction.
create or replace function note_cache_hit(h text) returns void as $$
  update tts_cache set hits = hits + 1, last_used = now() where hash = h;
$$ language sql security definer;

-- ----------------------------------------------------------------------------
-- 6. PERMISSIONS — Row-Level Security (§5)
-- ----------------------------------------------------------------------------
-- Role the current user has on a project (null = no access). Owner beats member.
create or replace function role_on(p uuid) returns text as $$
  select case
    when exists (select 1 from projects
                 where id = p and owner_id = auth.uid() and deleted_at is null)
      then 'owner'
    else (select role from project_members
          where project_id = p and user_id = auth.uid())
  end;
$$ language sql stable security definer;

alter table profiles         enable row level security;
alter table projects         enable row level security;
alter table files            enable row level security;
alter table project_members  enable row level security;
alter table versions         enable row level security;
alter table annotations      enable row level security;
alter table activity         enable row level security;
alter table reading_sessions enable row level security;
alter table usage_meters     enable row level security;
alter table plan_limits      enable row level security;
alter table tts_cache        enable row level security;

-- profiles: everyone signed in may read profiles (to show names/avatars);
-- you may only edit your own.
drop policy if exists read_profiles  on profiles;
drop policy if exists write_own_profile on profiles;
drop policy if exists insert_own_profile on profiles;
create policy read_profiles    on profiles for select using (auth.uid() is not null);
create policy write_own_profile on profiles for update using (id = auth.uid());
create policy insert_own_profile on profiles for insert with check (id = auth.uid());

-- projects: read if you have any role; insert only as yourself (owner);
-- update if owner/editor; only the owner may (soft-)delete via update.
drop policy if exists read_projects   on projects;
drop policy if exists insert_projects on projects;
drop policy if exists update_projects on projects;
create policy read_projects   on projects for select using (role_on(id) is not null);
create policy insert_projects on projects for insert with check (owner_id = auth.uid());
create policy update_projects on projects for update
  using (role_on(id) in ('owner','editor'))
  with check (role_on(id) in ('owner','editor'));

-- files: read for any member; write only owner/editor.
drop policy if exists read_files  on files;
drop policy if exists write_files on files;
create policy read_files  on files for select using (role_on(project_id) is not null);
create policy write_files on files for all
  using (role_on(project_id) in ('owner','editor'))
  with check (role_on(project_id) in ('owner','editor'));

-- members: read for any member; only the owner may manage.
drop policy if exists read_members   on project_members;
drop policy if exists manage_members on project_members;
create policy read_members   on project_members for select using (role_on(project_id) is not null);
create policy manage_members on project_members for all
  using (role_on(project_id) = 'owner')
  with check (role_on(project_id) = 'owner');

-- versions: read for any member; create by owner/editor.
drop policy if exists read_versions  on versions;
drop policy if exists write_versions on versions;
create policy read_versions  on versions for select using (role_on(project_id) is not null);
create policy write_versions on versions for insert
  with check (role_on(project_id) in ('owner','editor'));

-- annotations: read for any member; create by owner/editor/commenter;
-- update/delete your own (owner may moderate any).
drop policy if exists read_annotations   on annotations;
drop policy if exists write_annotations  on annotations;
drop policy if exists modify_annotations on annotations;
create policy read_annotations  on annotations for select using (role_on(project_id) is not null);
create policy write_annotations on annotations for insert
  with check (role_on(project_id) in ('owner','editor','commenter'));
create policy modify_annotations on annotations for update
  using (author_id = auth.uid() or role_on(project_id) = 'owner');

-- activity: read for any member; insert by any member (their own actions).
drop policy if exists read_activity  on activity;
drop policy if exists write_activity on activity;
create policy read_activity  on activity for select using (role_on(project_id) is not null);
create policy write_activity on activity for insert
  with check (role_on(project_id) is not null and actor_id = auth.uid());

-- reading sessions + usage meters: strictly your own rows.
drop policy if exists own_reading on reading_sessions;
drop policy if exists own_usage   on usage_meters;
create policy own_reading on reading_sessions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_usage on usage_meters for select using (user_id = auth.uid());

-- plan_limits: public reference data — any signed-in user may read.
drop policy if exists read_plan_limits on plan_limits;
create policy read_plan_limits on plan_limits for select using (true);

-- tts_cache: readable by any signed-in user (it's content, not personal data);
-- writes happen only through the security-definer functions above.
drop policy if exists read_cache on tts_cache;
create policy read_cache on tts_cache for select using (auth.uid() is not null);

-- ----------------------------------------------------------------------------
-- 7. STORAGE BUCKET POLICIES  (§6)
--    Run AFTER creating a PRIVATE bucket named 'project-files' in the
--    Supabase dashboard (Storage → New bucket → uncheck "Public").
--    Object path convention: <projectId>/<filename>
-- ----------------------------------------------------------------------------
drop policy if exists read_uploads  on storage.objects;
drop policy if exists write_uploads on storage.objects;
create policy read_uploads on storage.objects for select
  using (bucket_id = 'project-files'
     and role_on(((storage.foldername(name))[1])::uuid) is not null);
create policy write_uploads on storage.objects for all
  using (bucket_id = 'project-files'
     and role_on(((storage.foldername(name))[1])::uuid) in ('owner','editor'))
  with check (bucket_id = 'project-files'
     and role_on(((storage.foldername(name))[1])::uuid) in ('owner','editor'));

-- ============================================================================
--  Done. Next: enable Realtime on the tables you want to stream
--  (Database → Replication → supabase_realtime): files, annotations, activity.
-- ============================================================================
