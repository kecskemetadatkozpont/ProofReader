-- ============================================================================
--  Publify — migration 36: Journal recommender reference data.
--  journals_ref = global journal reference (Norwegian publication register / kanalregister.hkdir.no,
--  optionally enriched with Scimago SJR on ISSN). Read-only to all authenticated users; written only by
--  the service-role ingestion. research_journal_picks = a project's recommended/shortlisted venues.
-- ============================================================================
create table if not exists journals_ref (
  id            bigint primary key,                 -- kanalregister journal_id
  title         text not null,
  title_intl    text,
  issn_print    text,
  issn_online   text,
  discipline    text,                               -- NPI Academic Discipline
  field         text,                               -- NPI Scientific Field
  npi_level     int,                                -- current Norwegian level (1 or 2; higher = more prestigious)
  npi_level_year int,
  open_access   text,
  country       text,
  language      text,
  publisher     text,
  url           text,
  sjr           numeric,                            -- Scimago (nullable; merged on ISSN later)
  sjr_quartile  text,
  h_index       int,
  scimago_categories text,
  search        tsvector generated always as (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(title_intl,'') || ' ' || coalesce(field,'') || ' ' || coalesce(discipline,''))) stored,
  updated_at    timestamptz not null default now()
);
create index if not exists journals_ref_field_idx on journals_ref (field);
create index if not exists journals_ref_level_idx on journals_ref (npi_level);
create index if not exists journals_ref_issn_p_idx on journals_ref (issn_print);
create index if not exists journals_ref_issn_o_idx on journals_ref (issn_online);
create index if not exists journals_ref_search_idx on journals_ref using gin (search);
alter table journals_ref enable row level security;
drop policy if exists journals_ref_read on journals_ref;
create policy journals_ref_read on journals_ref for select to authenticated using (true);

create table if not exists research_journal_picks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references research_projects(id) on delete cascade,
  journal_id   bigint references journals_ref(id) on delete set null,
  title        text not null,                       -- snapshot
  field        text, npi_level int, sjr_quartile text, url text,
  fit_score    int,                                 -- 0-100 suitability for this project
  fit_reason   text,
  status       text not null default 'suggested',   -- suggested | shortlisted | rejected | submitted
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists rjp_project_idx on research_journal_picks(project_id);
alter table research_journal_picks enable row level security;
drop policy if exists rjp_read on research_journal_picks;
create policy rjp_read on research_journal_picks for select to authenticated using (research_can_read_project(project_id));
drop policy if exists rjp_write on research_journal_picks;
create policy rjp_write on research_journal_picks for all to authenticated using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));
