-- ============================================================================
--  Publify — migration 94: person-to-person messaging (DM) foundation.
--
--  A NEW layer, distinct from the AI chats (research_chats/research_messages are
--  Claude conversations; user_chats is the Claude session). This is colleague ↔
--  colleague messaging that spans the whole platform, with the ability to embed
--  references to platform entities (an idea / source / study / figure / file) so
--  you can ask others' opinion about a specific thing.
--
--  P0 scope: 1:1 DMs + text + file attachments + entity references + unread.
--  (Group threads and entity-anchored discussion threads reuse the same tables:
--   dm_threads.kind = 'dm' | 'group' | 'entity'.)
--
--  Reuses: profiles_public / pr_search_users (find anyone), the notifications
--  table + RPC pattern (migration-85), Supabase Realtime.
--
--  Additive + idempotent. Run in the Supabase SQL editor.
-- ============================================================================

-- ---- tables ---------------------------------------------------------------
create table if not exists public.dm_threads (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'dm',              -- 'dm' | 'group' | 'entity'
  title       text,                                    -- for groups
  entity      jsonb,                                   -- for kind='entity': {kind,id,project_id,label}
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.dm_thread_members (
  thread_id   uuid not null references public.dm_threads(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (thread_id, user_id)
);
create index if not exists dm_tm_user_idx on public.dm_thread_members(user_id);

create table if not exists public.dm_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.dm_threads(id) on delete cascade,
  sender_id   uuid not null references public.profiles(id) on delete set null,
  body        text not null default '',
  attachments jsonb,                                   -- [{bucket,path,name,mime}]
  refs        jsonb,                                   -- [{kind,id,project_id,label}] — the entity references
  created_at  timestamptz not null default now()
);
create index if not exists dm_msg_thread_idx on public.dm_messages(thread_id, created_at);

create table if not exists public.dm_reads (
  thread_id     uuid not null references public.dm_threads(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (thread_id, user_id)
);

-- ---- membership helper (SECURITY DEFINER → no RLS recursion) ---------------
create or replace function public.dm_is_member(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dm_thread_members m where m.thread_id = tid and m.user_id = auth.uid());
$$;

-- ---- RLS ------------------------------------------------------------------
alter table public.dm_threads enable row level security;
drop policy if exists dm_t_read on public.dm_threads;
create policy dm_t_read on public.dm_threads for select to authenticated using (public.dm_is_member(id) or created_by = auth.uid());
drop policy if exists dm_t_write on public.dm_threads;
create policy dm_t_write on public.dm_threads for all to authenticated
  using (public.dm_is_member(id)) with check (created_by = auth.uid());

alter table public.dm_thread_members enable row level security;
drop policy if exists dm_m_read on public.dm_thread_members;
create policy dm_m_read on public.dm_thread_members for select to authenticated using (public.dm_is_member(thread_id) or user_id = auth.uid());
drop policy if exists dm_m_write on public.dm_thread_members;
-- the thread creator may add/remove members; a member may remove THEMSELVES (leave). Creation of 1:1 threads
-- goes through dm_start_dm (SECURITY DEFINER) which bypasses this and seeds both members atomically.
create policy dm_m_write on public.dm_thread_members for all to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.dm_threads t where t.id = thread_id and t.created_by = auth.uid()))
  with check (exists (select 1 from public.dm_threads t where t.id = thread_id and t.created_by = auth.uid()));

alter table public.dm_messages enable row level security;
drop policy if exists dm_msg_read on public.dm_messages;
create policy dm_msg_read on public.dm_messages for select to authenticated using (public.dm_is_member(thread_id));
drop policy if exists dm_msg_write on public.dm_messages;
create policy dm_msg_write on public.dm_messages for all to authenticated
  using (public.dm_is_member(thread_id) and sender_id = auth.uid())
  with check (public.dm_is_member(thread_id) and sender_id = auth.uid());

alter table public.dm_reads enable row level security;
drop policy if exists dm_reads_rw on public.dm_reads;
create policy dm_reads_rw on public.dm_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- bump thread.updated_at on every new message (drives list ordering + "recent")
create or replace function public.dm_touch_thread() returns trigger
language plpgsql security definer set search_path = public as $$
begin update public.dm_threads set updated_at = now() where id = new.thread_id; return new; end; $$;
drop trigger if exists dm_msg_touch on public.dm_messages;
create trigger dm_msg_touch after insert on public.dm_messages for each row execute function public.dm_touch_thread();

-- ---- find-or-create a 1:1 DM thread between the caller and p_other ---------
create or replace function public.dm_start_dm(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; me uuid := auth.uid();
begin
  if me is null or p_other is null or p_other = me then return null; end if;
  if not exists (select 1 from public.profiles where id = p_other) then raise exception 'unknown user'; end if;
  -- existing 1:1 thread with EXACTLY {me, other}?
  select t.id into tid from public.dm_threads t
   where t.kind = 'dm'
     and exists (select 1 from public.dm_thread_members m where m.thread_id = t.id and m.user_id = me)
     and exists (select 1 from public.dm_thread_members m where m.thread_id = t.id and m.user_id = p_other)
     and (select count(*) from public.dm_thread_members m where m.thread_id = t.id) = 2
   limit 1;
  if tid is not null then return tid; end if;
  insert into public.dm_threads (kind, created_by) values ('dm', me) returning id into tid;
  insert into public.dm_thread_members (thread_id, user_id) values (tid, me), (tid, p_other);
  return tid;
end; $$;
grant execute on function public.dm_start_dm(uuid) to authenticated;

-- ---- notify the other participant(s) of a new DM (best-effort) -------------
create or replace function public.pr_notify_dm(p_recipient uuid, p_thread uuid, p_excerpt text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_recipient is null or p_thread is null then return; end if;
  if not public.dm_is_member(p_thread) then raise exception 'not a member of this thread'; end if;   -- only participants may notify
  if not exists (select 1 from public.dm_thread_members m where m.thread_id = p_thread and m.user_id = p_recipient) then return; end if;
  insert into public.notifications (recipient_id, kind, payload)
  values (p_recipient, 'request', jsonb_build_object(
    'type', 'dm', 'thread_id', p_thread,
    'from', (select name from public.profiles where id = auth.uid()), 'from_id', auth.uid(),
    'excerpt', left(coalesce(p_excerpt, ''), 140)));
end; $$;
grant execute on function public.pr_notify_dm(uuid, uuid, text) to authenticated;

-- ---- realtime: live message + thread updates ------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'dm_messages') then
    alter publication supabase_realtime add table public.dm_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'dm_threads') then
    alter publication supabase_realtime add table public.dm_threads;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Verify (optional):
--   select public.dm_start_dm('<other-user-uuid>');   -- returns a thread id
--   select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename like 'dm_%';  -- 2 rows
-- ---------------------------------------------------------------------------
