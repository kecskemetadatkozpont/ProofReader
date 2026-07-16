-- migration-64: record figure-extraction ATTEMPTS that produced nothing, so background re-runs skip them.
--
-- Problem: the figure extractor (PRFigureRunner in research.jsx + figure-board.js) only records POSITIVE results
-- as research_figures rows. Papers with no open-access PDF, or an OA PDF that has no "Figure N" captioned images,
-- write nothing, so every restart re-attempts them from scratch. This column marks the terminal negative outcomes
-- so the extractor can skip them on resume. (Positive results stay recorded in research_figures.)
--
-- Values: null = not yet attempted · 'ok' = figures found · 'no_oa' = no open-access PDF ·
--         'no_figs' = OA PDF but no captioned figures · 'error' = transient failure (RETRYABLE — not skipped).
-- Only 'no_oa' and 'no_figs' (and, if present, 'ok') are treated as skip; 'error'/null are retried.
--
-- No RLS change: research_sources already allows project members to UPDATE their rows (same policy used by screening).

alter table research_sources add column if not exists fig_status text;

comment on column research_sources.fig_status is
  'Figure-extraction outcome: ok=figures found, no_oa=no open-access PDF, no_figs=OA PDF had no captioned figures, error=transient (retryable), null=not attempted. Background extractors skip no_oa/no_figs on resume.';
