-- migration-18 — per-user system prompt for the Idea-tab "Chat with Publify".
-- Each researcher owns one editable system prompt that the research-chat Edge function injects.
-- RLS: a user reads/writes only their own row; admins may read/write any (for seeding & support).

create table if not exists public.research_system_prompts (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  prompt     text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.research_system_prompts enable row level security;

drop policy if exists rsp_rw on public.research_system_prompts;
create policy rsp_rw on public.research_system_prompts for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
