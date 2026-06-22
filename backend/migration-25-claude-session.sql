-- migration-25: a plain, full Claude chat for users (Zola-style), independent of research projects.
-- user_chats = a conversation in the left history sidebar; user_chat_messages = its turns.
create table if not exists public.user_chats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists public.user_chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.user_chats(id) on delete cascade,
  role text not null,
  content text,
  created_at timestamptz default now()
);
alter table public.user_chats enable row level security;
alter table public.user_chat_messages enable row level security;
-- owner-only (admins also pass via the existing is-admin pattern used elsewhere — but a plain owner check is enough here)
drop policy if exists uc_owner on public.user_chats;
create policy uc_owner on public.user_chats for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists ucm_owner on public.user_chat_messages;
create policy ucm_owner on public.user_chat_messages for all to authenticated
  using (exists (select 1 from public.user_chats c where c.id = chat_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.user_chats c where c.id = chat_id and c.owner_id = auth.uid()));
create index if not exists ucm_chat_idx on public.user_chat_messages(chat_id);
create index if not exists uc_owner_idx on public.user_chats(owner_id);

-- item 4: admins gate who may launch advanced Claude workflows (a per-user flag, like ai_model)
alter table public.profiles add column if not exists can_workflows boolean not null default false;
comment on column public.profiles.can_workflows is 'Admin-set: may the user launch Claude workflows in the session.';
