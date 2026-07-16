-- migration-65: per-project content/UI language. Chosen at project creation (and editable in Settings). Drives
-- the language of AI-generated content (ideas, SR questions/reviews, protocol, drafts, chat, gap analysis, …) and
-- the core UI chrome (nav / tab labels / primary buttons). Existing projects default to 'en' (no visible change);
-- new projects pick it in the create form.
--
-- Values: 'en' | 'hu'. No RLS change (research_projects already permits owner/member updates).

alter table research_projects add column if not exists language text not null default 'en';

comment on column research_projects.language is
  'Project language for AI-generated content + core UI chrome: en | hu. The user may still request the other language ad hoc for a specific action.';
