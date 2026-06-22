-- migration-35: persist the OA full-text PDF url on research_sources, so the literature-study step-3
-- screener can fetch the PDF (it only had the DOI/landing url before, forcing the abstract fallback).
alter table public.research_sources add column if not exists oa_pdf_url text;
