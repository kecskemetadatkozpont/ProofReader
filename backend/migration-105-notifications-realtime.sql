-- migration-105-notifications-realtime.sql
-- Live notifications — add the `notifications` table to the `supabase_realtime` publication so a new
-- project invitation (or any notification) is pushed to the recipient's bell WITHOUT a page reload.
-- The bell already subscribes to postgres_changes on notifications filtered to recipient_id=eq.<uid>;
-- RLS (nf_read: recipient_id = auth.uid() or is_admin(), migration-11) still scopes delivery on the socket,
-- so a user only ever receives their OWN notifications. Idempotent — safe to re-run.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- verify:
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications';  -- expect 1 row
