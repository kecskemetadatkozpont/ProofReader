-- ============================================================================
--  Publify — migration 15: Research R3 (datasets) + R4 (compute jobs queue).
--  research_datasets: registry of project data (uploaded or to-be-downloaded by the
--  self-hosted worker). research_jobs: a queue the worker polls (service-role) to run
--  compute off the browser and write results back. RLS reuses research_can_read/write_project.
--  Run in the SQL editor. Idempotent.
-- ============================================================================

create table if not exists research_datasets (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references research_projects(id) on delete cascade,
  name        text not null,
  source      text not null default 'url',     -- upload | huggingface | kaggle | zenodo | openml | url | other
  uri         text,                             -- storage path (upload) or external identifier/URL
  size_bytes  bigint,
  license     text,
  status      text not null default 'registered', -- registered | downloading | ready | error
  local_path  text,                             -- where the worker placed it
  notes       text,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists rd_project_idx on research_datasets(project_id);

create table if not exists research_jobs (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references research_projects(id) on delete cascade,
  type          text not null default 'python',  -- python | download | stats | notebook
  title         text not null,
  spec          jsonb not null default '{}'::jsonb,
  status        text not null default 'queued',  -- queued | running | done | error | canceled
  progress      int not null default 0,
  result        jsonb,                            -- small results inline
  result_path   text,                             -- storage path for large artifacts
  logs          text,
  compute_target text not null default 'self-hosted',
  cost          numeric,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
create index if not exists rj_project_idx on research_jobs(project_id);
create index if not exists rj_status_idx on research_jobs(status) where status = 'queued';

-- ---- RLS (read = can-read project, write = can-write project) ---------------
alter table research_datasets enable row level security;
drop policy if exists rd_read on research_datasets;
create policy rd_read on research_datasets for select to authenticated using (research_can_read_project(project_id));
drop policy if exists rd_write on research_datasets;
create policy rd_write on research_datasets for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));

alter table research_jobs enable row level security;
drop policy if exists rj_read on research_jobs;
create policy rj_read on research_jobs for select to authenticated using (research_can_read_project(project_id));
drop policy if exists rj_write on research_jobs;
create policy rj_write on research_jobs for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));
-- the worker connects with the service-role key (bypasses RLS) to claim queued jobs + write results.

-- ---- Storage: research-data bucket, scoped by the first path segment = project_id -----------
-- parse a uuid safely (a bad path segment yields null, never an error that breaks the policy)
create or replace function public.safe_uuid(t text) returns uuid
language sql immutable as $$ select case when t ~ '^[0-9a-fA-F-]{36}$' then t::uuid else null end $$;

insert into storage.buckets (id, name, public) values ('research-data', 'research-data', false)
  on conflict (id) do nothing;

drop policy if exists research_data_read on storage.objects;
create policy research_data_read on storage.objects for select to authenticated
  using (bucket_id = 'research-data' and research_can_read_project(public.safe_uuid((storage.foldername(name))[1])));
drop policy if exists research_data_insert on storage.objects;
create policy research_data_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'research-data' and research_can_write_project(public.safe_uuid((storage.foldername(name))[1])));
drop policy if exists research_data_delete on storage.objects;
create policy research_data_delete on storage.objects for delete to authenticated
  using (bucket_id = 'research-data' and research_can_write_project(public.safe_uuid((storage.foldername(name))[1])));
