-- migration-26: files an agentic Claude workflow writes inside a session (item 4). Owner-scoped via the chat.
create table if not exists public.user_chat_files (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.user_chats(id) on delete cascade,
  path text not null,
  content text,
  source text default 'agent',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (chat_id, path)
);
alter table public.user_chat_files enable row level security;
drop policy if exists ucf_owner on public.user_chat_files;
create policy ucf_owner on public.user_chat_files for all to authenticated
  using (exists (select 1 from public.user_chats c where c.id = chat_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.user_chats c where c.id = chat_id and c.owner_id = auth.uid()));
create index if not exists ucf_chat_idx on public.user_chat_files(chat_id);
