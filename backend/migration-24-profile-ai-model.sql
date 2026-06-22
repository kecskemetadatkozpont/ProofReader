-- migration-24: per-user AI model. Admins set which model a user's research AI (chat + gap analysis) uses.
-- null = the system default (RESEARCH_AI_MODEL / sonnet). The Edge functions validate against a whitelist.
alter table public.profiles add column if not exists ai_model text;
comment on column public.profiles.ai_model is 'Per-user Claude model id for research-chat / research-ai; null = system default. Set by admins.';
