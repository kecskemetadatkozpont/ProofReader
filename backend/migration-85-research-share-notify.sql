-- ============================================================================
--  Publify — migration 85: deliver research/map collaboration notifications
--
--  BUG: sharing a research project from the Map ("👥 Megosztás") created the
--  research_project_members row but the invitee got NO notification, so they
--  never learned of the invite (a pending member can't even read the project
--  until accepted → the invite was undiscoverable).
--
--  ROOT CAUSE: migration-31 made direct `notifications` inserts self-only, and
--  its share-notify RPC `pr_notify_share` checks the WRONG tables
--  (public.projects / project_members — the LaTeX-editor system), so it can
--  neither authorize nor deliver a notification for a research/map project.
--  The @mention path had the same defect (blocked self-only direct insert).
--
--  FIX: two SECURITY DEFINER RPCs scoped to the RESEARCH tables. Additive and
--  idempotent — no table/RLS changes. Until applied the app degrades to today's
--  behavior (member row created, no notification). Safe to re-run.
-- ============================================================================

-- Invite notification: only the project OWNER (or admin) may send it.
create or replace function public.pr_notify_research_share(p_recipient uuid, p_project uuid, p_title text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_recipient is null or p_project is null then return; end if;
  if not (public.is_admin() or exists (
        select 1 from public.research_projects p where p.id = p_project and p.owner_id = auth.uid())) then
    raise exception 'not authorized to notify for this project';
  end if;
  insert into public.notifications (recipient_id, kind, payload)
  values (p_recipient, 'share', jsonb_build_object(
    'type', 'research_share', 'project_id', p_project, 'title', coalesce(nullif(p_title, ''), 'Projekt'),
    'role', coalesce(p_role, 'viewer'),
    'by', (select name from public.profiles where id = auth.uid()), 'by_id', auth.uid()));
end;
$$;
grant execute on function public.pr_notify_research_share(uuid, uuid, text, text) to authenticated;

-- @mention notification: the caller must be able to READ the project, and the
-- recipient must actually be a member (don't leak mentions to arbitrary users).
create or replace function public.pr_notify_research_mention(p_recipient uuid, p_project uuid, p_title text, p_excerpt text, p_node text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_recipient is null or p_project is null then return; end if;
  if not public.research_can_read_project(p_project) then
    raise exception 'not authorized to notify for this project';
  end if;
  if not exists (select 1 from public.research_project_members m
                 where m.project_id = p_project and m.user_id = p_recipient) then
    return;   -- only notify actual collaborators
  end if;
  insert into public.notifications (recipient_id, kind, payload)
  values (p_recipient, 'request', jsonb_build_object(
    'type', 'research_map_mention', 'project_id', p_project, 'project_title', coalesce(p_title, ''),
    'from', (select name from public.profiles where id = auth.uid()),
    'excerpt', left(coalesce(p_excerpt, ''), 140), 'node_id', p_node));
end;
$$;
grant execute on function public.pr_notify_research_mention(uuid, uuid, text, text, text) to authenticated;
