-- ============================================================================
--  Publify — migration 95: group conversations for the DM messenger.
--
--  The dm_* schema (migration-94) already supports groups: dm_threads.kind can be
--  'group' and dm_thread_members holds N members. This adds a find-or-create-free
--  constructor RPC that atomically creates a group thread and seeds the members
--  (SECURITY DEFINER, so it bypasses the member-insert RLS just like dm_start_dm).
--
--  Additive + idempotent. Run in the Supabase SQL editor.
-- ============================================================================

create or replace function public.dm_start_group(p_name text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; me uuid := auth.uid(); mid uuid; cnt int := 0;
begin
  if me is null then return null; end if;
  insert into public.dm_threads (kind, title, created_by)
    values ('group', nullif(btrim(coalesce(p_name, '')), ''), me) returning id into tid;
  insert into public.dm_thread_members (thread_id, user_id) values (tid, me);
  if p_members is not null then
    foreach mid in array p_members loop
      if mid is not null and mid <> me and exists (select 1 from public.profiles where id = mid) then
        insert into public.dm_thread_members (thread_id, user_id) values (tid, mid) on conflict do nothing;
        cnt := cnt + 1;
      end if;
    end loop;
  end if;
  -- a "group" needs at least one other member; otherwise roll it back so we don't leave an empty thread
  if cnt = 0 then delete from public.dm_threads where id = tid; return null; end if;
  return tid;
end; $$;
grant execute on function public.dm_start_group(text, uuid[]) to authenticated;
