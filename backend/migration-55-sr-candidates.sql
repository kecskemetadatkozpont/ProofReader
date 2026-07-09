-- ============================================================================
--  Publify — migration 55: systematic-review candidate questions (from Ideas)
--
--  Backs the redesigned Studies flow: "✨ Generate from Ideas" turns each project
--  research_idea into ONE systematic-review-ready question with a PICO frame,
--  screening criteria, and extraction questions — shown as a card, from which the
--  user launches an Elicit systematic review (elicit_jobs, migration-51/52).
--
--  Prereq: migration-34 (research_projects/research_ideas) + migration-49 (is_admin).
--  Apply in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

create table if not exists public.research_sr_candidates (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.research_projects(id) on delete cascade,
  idea_id              uuid references public.research_ideas(id) on delete cascade,
  question             text not null,                 -- SR-ready research question
  pico                 jsonb,                          -- { population, intervention, comparison, outcome }
  abstract_criteria    text[],                         -- suggested abstract-screening inclusion criteria
  extraction_questions text[],                         -- suggested data-extraction questions
  study_type           text,                           -- e.g. 'interventional' | 'qualitative' | 'mixed'
  dismissed            boolean not null default false, -- user hid this card
  launched_job_id      uuid,                           -- the elicit_jobs row once a review is started from this card
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (project_id, idea_id)                         -- one candidate per idea (re-generate overwrites)
);
create index if not exists research_sr_candidates_project_idx on public.research_sr_candidates(project_id, created_at desc);

alter table public.research_sr_candidates enable row level security;
drop policy if exists rsc_read  on public.research_sr_candidates;
create policy rsc_read  on public.research_sr_candidates for select to authenticated
  using (public.research_can_read_project(project_id));
drop policy if exists rsc_write on public.research_sr_candidates;
create policy rsc_write on public.research_sr_candidates for all to authenticated
  using (public.research_can_write_project(project_id)) with check (public.research_can_write_project(project_id));
grant select, insert, update, delete on table public.research_sr_candidates to authenticated;

-- Verify after apply:  select count(*) from research_sr_candidates;   -- 0
