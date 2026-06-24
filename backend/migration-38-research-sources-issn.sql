-- Store the journal ISSN(s) on each fetched source so the client can map venue → Scopus/SCImago quartile (Q1–Q4)
-- for the literature-study results (sort by citations / journal / quartile).
alter table research_sources add column if not exists issn text;   -- comma-joined 8-char ISSNs (issn_l first)
