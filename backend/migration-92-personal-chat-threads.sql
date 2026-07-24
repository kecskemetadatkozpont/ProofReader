-- ============================================================================
--  Publify — migration 92: per-user AI chat threads + read-only peek foundation.
--
--  Today BOTH AI surfaces (the Ideas "Publify beszélgetés" and the Map/Canvas dock
--  assistant) are ONE shared research_chats row per project — the client just loads
--  the first row — and research_messages has NO sender column (only role user|
--  assistant). So nobody can tell who said what, and everyone writes into the same
--  thread.
--
--  This is the FOUNDATION for the "personal threads + live peek" feature (F1). The
--  keystone: authorship is carried by the THREAD's owner_id, NOT a per-message
--  sender — the schema-fragile research_messages table stays untouched. Each user
--  gets their own thread per surface; any project member may READ (peek) another
--  thread, but WRITING into someone else's thread is blocked at the RLS level, so
--  "read-only peek" is enforced in the database, not merely hidden in the UI. The
--  existing shared rows keep owner_id = NULL and live on as the optional
--  "közös / csapat" thread — no data loss.
--
--  Additive + idempotent. Run in the Supabase SQL editor. Requires migration-16/23.
--  ORDER MATTERS: apply this BEFORE deploying the research.jsx client that queries
--  owner_id/surface, or the chat panel 42703's on the missing column.
-- ============================================================================

-- 1) per-user threading columns on research_chats -----------------------------
alter table public.research_chats add column if not exists owner_id uuid references public.profiles(id) on delete set null;
alter table public.research_chats add column if not exists surface  text;

-- Backfill surface for the two legacy shared threads. owner_id stays NULL on these
-- existing rows → they become the single shared "közös / csapat" thread per surface.
update public.research_chats set surface = 'canvas'
  where surface is null and title = 'Canvas asszisztens';
update public.research_chats set surface = 'ideas'
  where surface is null;   -- everything else (incl. 'Publify chat'/'Consensus chat') is the Ideas surface

-- One thread per (project, surface, owner). A NULL owner collapses to a single
-- sentinel key, so there is at most ONE shared thread per surface alongside the
-- per-user ones. (A stray duplicate legacy row would make this index fail to build —
-- de-dup first if so; on this dataset there is one row per surface.)
create unique index if not exists research_chats_surface_owner_uk
  on public.research_chats (project_id, surface, coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 2) exact file -> thread provenance ("files from THIS thread") ----------------
alter table public.research_files add column if not exists chat_id uuid references public.research_chats(id) on delete set null;
create index if not exists research_files_chat_idx on public.research_files(chat_id);

-- 3) read-only peek, enforced at the DB level ---------------------------------
-- READ stays open to any project member (that IS the peek). WRITE is restricted to
-- your OWN thread or the shared team thread (owner_id IS NULL). This tightens the
-- helper that rm_write / re_write already use, so INSERTs into a colleague's thread
-- are denied even though the messages remain readable. rm_read / re_read (via
-- research_can_read_chat) are UNCHANGED → peeking keeps working.
create or replace function public.research_can_write_chat(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.research_chats c
    where c.id = cid
      and public.research_can_write_project(c.project_id)
      and (c.owner_id = auth.uid() or c.owner_id is null)   -- own thread OR the shared team thread
  );
$$;

-- research_chats' own write policy: you may create/update/delete only your own
-- thread (or the shared owner_id IS NULL thread). rc_read is left as-is so any
-- project reader can list every thread for the collaborator rail + peek.
drop policy if exists rc_write on public.research_chats;
create policy rc_write on public.research_chats for all to authenticated
  using (research_can_write_project(project_id) and (owner_id = auth.uid() or owner_id is null))
  with check (research_can_write_project(project_id) and (owner_id = auth.uid() or owner_id is null));

-- 4) realtime: stream messages + files to peekers and the shared file browser --
-- (research_map_* are already published; these two are not — add them, matching the
--  existing idempotent pattern used by migration-62/63/68/72/73.)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'research_messages') then
    alter publication supabase_realtime add table public.research_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'research_files') then
    alter publication supabase_realtime add table public.research_files;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Verify (optional):
--   select surface, owner_id, count(*) from research_chats group by 1,2;   -- legacy rows have owner_id NULL
--   select tablename from pg_publication_tables
--     where pubname='supabase_realtime' and tablename in ('research_messages','research_files');  -- 2 rows
-- ---------------------------------------------------------------------------
