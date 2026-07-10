-- ============================================================================
--  Publify — migration 60: per-source "why relevant" blurb
--
--  Adds research_sources.relevance — a short (<=2 sentence) AI-generated note on
--  why the publication is relevant to its project's research (title/field/goal/
--  keywords). Generated once by research-study `relevance_batch` and cached here,
--  shown on the Figure Board's By-paper clusters + the figure drawer.
--
--  Prereq: migration-14 (research_sources). Idempotent.
-- ============================================================================

alter table public.research_sources add column if not exists relevance text;

-- (RLS unchanged — relevance is covered by the existing research_sources row policies.)
-- Verify:  select count(*) from research_sources where relevance is not null;
