-- ============================================================================
--  Publify — migration 93: publish research_chats for the live collaborator rail.
--
--  The F1 per-user chat rail (research.jsx ChatPanel) lists every member's ideas
--  thread. When a colleague STARTS their first thread, other members' rails should
--  show it without a manual reload. The client already refreshes on presence-sync
--  and on tab-focus (no migration needed), but adding research_chats to the realtime
--  publication makes the appearance INSTANT via the postgres_changes handler on the
--  rchat:<project_id> channel.
--
--  (migration-92 already published research_messages + research_files; this adds the
--   chats table itself, matching the same idempotent pattern.)
--  Additive + idempotent. Run in the Supabase SQL editor.
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'research_chats') then
    alter publication supabase_realtime add table public.research_chats;
  end if;
end $$;
