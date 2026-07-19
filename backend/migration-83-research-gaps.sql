-- migration-83: Research-gap analysis — additive columns on research_ideas.
--
-- A research GAP is modelled as a research_ideas row with source='gap', enriched by three
-- additive columns (no new table — this inherits Map materialization ('i'+id), research_map_layout
-- positions, the placeInFrame/undo pipeline, the Ideas list, and the existing project-scoped RLS).
-- ADDITIVE ONLY. No RLS change (research_ideas policies apply unchanged). Realtime is inherited.
--
-- Apply in the Supabase SQL editor (project ref jokqthwszkweyqmmdesn). The client graceful-degrades
-- before this runs: GapPanel probes for these columns and falls back to untyped source='gap' ideas.

alter table public.research_ideas add column if not exists gap_type text;
alter table public.research_ideas add column if not exists evidence jsonb;
alter table public.research_ideas add column if not exists addressed_by_idea_id uuid references public.research_ideas(id) on delete set null;

comment on column public.research_ideas.gap_type is 'research-gap taxonomy slug: evidence|knowledge|methodological|population|theoretical|practical|contradictory (migration-83)';
comment on column public.research_ideas.evidence is 'jsonb array grounding the gap claim: [{source_ref|title, coverage|note}] (migration-83)';
comment on column public.research_ideas.addressed_by_idea_id is 'the idea row that closes/addresses this gap — set when a gap is promoted to an idea (migration-83)';

-- optional: speeds up the GapPanel query (source='gap' ideas ordered by novelty)
create index if not exists research_ideas_gap_idx on public.research_ideas (project_id) where source = 'gap';
