-- ============================================================================
--  Publify — migration 16: Research R5b (Ideas chat with Consensus via MCP).
--  Persists the whole conversation so the app OWNS and can reuse everything the
--  user discussed with Consensus: research_chats + research_messages (incl. the raw
--  tool-use/tool-result blocks) + research_evidence (structured Consensus hits).
--  RLS reuses research_can_read/write_project. Run in the SQL editor. Idempotent.
-- ============================================================================

create table if not exists research_chats (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references research_projects(id) on delete cascade,
  title       text not null default 'Consensus chat',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists rc_project_idx on research_chats(project_id);

create table if not exists research_messages (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references research_chats(id) on delete cascade,
  role        text not null,                    -- user | assistant
  content     text not null default '',         -- the plain text
  blocks      jsonb,                            -- raw Anthropic content blocks (text + mcp_tool_use/result)
  created_at  timestamptz not null default now()
);
create index if not exists rm_chat_idx on research_messages(chat_id, created_at);

create table if not exists research_evidence (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references research_chats(id) on delete cascade,
  message_id  uuid references research_messages(id) on delete set null,
  query       text,
  title       text,
  doi         text,
  year        int,
  journal     text,
  claim       text,
  snippet     text,
  url         text,
  created_at  timestamptz not null default now()
);
create index if not exists re_chat_idx on research_evidence(chat_id);

-- ---- access helpers (a chat is readable/writable if its project is) ----------
create or replace function public.research_can_read_chat(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.research_chats c where c.id = cid and public.research_can_read_project(c.project_id));
$$;
create or replace function public.research_can_write_chat(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.research_chats c where c.id = cid and public.research_can_write_project(c.project_id));
$$;

-- ---- RLS -------------------------------------------------------------------
alter table research_chats enable row level security;
drop policy if exists rc_read on research_chats;
create policy rc_read on research_chats for select to authenticated using (research_can_read_project(project_id));
drop policy if exists rc_write on research_chats;
create policy rc_write on research_chats for all to authenticated
  using (research_can_write_project(project_id)) with check (research_can_write_project(project_id));

alter table research_messages enable row level security;
drop policy if exists rm_read on research_messages;
create policy rm_read on research_messages for select to authenticated using (research_can_read_chat(chat_id));
drop policy if exists rm_write on research_messages;
create policy rm_write on research_messages for all to authenticated
  using (research_can_write_chat(chat_id)) with check (research_can_write_chat(chat_id));

alter table research_evidence enable row level security;
drop policy if exists re_read on research_evidence;
create policy re_read on research_evidence for select to authenticated using (research_can_read_chat(chat_id));
drop policy if exists re_write on research_evidence;
create policy re_write on research_evidence for all to authenticated
  using (research_can_write_chat(chat_id)) with check (research_can_write_chat(chat_id));
-- the research-chat Edge Function writes assistant messages + evidence with the caller's JWT (RLS).

create or replace function public.research_touch_chat() returns trigger
language plpgsql as $$ begin update public.research_chats set updated_at = now() where id = new.chat_id; return new; end; $$;
drop trigger if exists rm_touch on research_messages;
create trigger rm_touch after insert on research_messages
  for each row execute function public.research_touch_chat();
