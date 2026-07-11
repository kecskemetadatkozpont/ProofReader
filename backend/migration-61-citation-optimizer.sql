-- ============================================================================
--  Publify — migration 61: Citation Optimizer
--
--  Analyzes what the top-cited INCLUDED papers of a project are cited FOR.
--  Engine: Semantic Scholar citation contexts + Claude intent classification.
--    citation_reports          — one analysis run per project (project-level strategy)
--    citation_paper_insights   — per top-paper: intent mix, contributions, sample
--                                citation sentences, "cited for" summary
--
--  Prereq: migration-11 (research_can_read/write_project), migration-14
--  (research_sources). Idempotent.
-- ============================================================================

create table if not exists public.citation_reports (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.research_projects(id) on delete cascade,
  status        text not null default 'processing',   -- processing | done | error
  strategy      text,                                  -- project-level synthesis (markdown)
  intent_totals jsonb,                                 -- {method,result,background} aggregate
  stats         jsonb,                                 -- {papers,resolved,contexts,influential,coverage}
  error         text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists citation_reports_project_idx on public.citation_reports(project_id, created_at desc);

create table if not exists public.citation_paper_insights (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references public.citation_reports(id) on delete cascade,
  project_id    uuid not null references public.research_projects(id) on delete cascade,  -- for RLS
  source_id     uuid references public.research_sources(id) on delete set null,
  rank          int,
  s2_id         text,                                  -- Semantic Scholar paperId (null = not indexed)
  doi           text,
  title         text,
  venue         text,
  year          int,
  cited_by      int,                                   -- our stored count (OpenAlex)
  citing_count  int,                                   -- citing records S2 returned
  influential   int,                                   -- of those, flagged influential
  intent_mix    jsonb,                                 -- {method,result,background,contrast,data}
  contributions jsonb,                                 -- [{label, count}]
  contexts      jsonb,                                 -- [{sentence,intent,citing_title,year,influential}]
  summary       text,                                  -- "cited for ..." (<=2 sentences)
  done          boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists citation_insights_report_idx on public.citation_paper_insights(report_id, rank);

alter table public.citation_reports enable row level security;
alter table public.citation_paper_insights enable row level security;

drop policy if exists cr_read  on public.citation_reports;
create policy cr_read  on public.citation_reports  for select to authenticated using (public.research_can_read_project(project_id));
drop policy if exists cr_write on public.citation_reports;
create policy cr_write on public.citation_reports  for all to authenticated
  using (public.research_can_write_project(project_id)) with check (public.research_can_write_project(project_id));

drop policy if exists ci_read  on public.citation_paper_insights;
create policy ci_read  on public.citation_paper_insights for select to authenticated using (public.research_can_read_project(project_id));
drop policy if exists ci_write on public.citation_paper_insights;
create policy ci_write on public.citation_paper_insights for all to authenticated
  using (public.research_can_write_project(project_id)) with check (public.research_can_write_project(project_id));

grant select, insert, update, delete on table public.citation_reports to authenticated;
grant select, insert, update, delete on table public.citation_paper_insights to authenticated;

-- Verify:  select count(*) from citation_reports;   -- 0
