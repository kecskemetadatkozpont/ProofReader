-- migration-31: stop notification spoofing. Previously nf_insert allowed any authed user to insert a
-- notification for ANY recipient. Now: direct inserts are self-only; share notifications go through a
-- SECURITY DEFINER RPC that verifies the caller actually owns/edits the project.

create or replace function public.pr_notify_share(p_recipient uuid, p_project uuid, p_title text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_recipient is null or p_project is null then return; end if;
  -- the caller must be the owner or an editor of the referenced project
  if not exists (
    select 1 from public.projects p where p.id = p_project and (
      p.owner_id = auth.uid()
      or exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = auth.uid() and m.role = 'editor')
    )
  ) then
    raise exception 'not authorized to notify for this project';
  end if;
  insert into public.notifications (recipient_id, kind, payload)
  values (p_recipient, 'share', jsonb_build_object(
    'type', 'share', 'project_id', p_project, 'title', coalesce(p_title, 'Untitled project'),
    'role', coalesce(p_role, 'editor'),
    'by', (select name from public.profiles where id = auth.uid()), 'by_id', auth.uid()));
end;
$$;
grant execute on function public.pr_notify_share(uuid, uuid, text, text) to authenticated;

-- tighten direct inserts: a user may only insert notifications addressed to themselves (admins/workers
-- and the share RPC are SECURITY DEFINER / service-role and bypass this).
drop policy if exists nf_insert on public.notifications;
create policy nf_insert on public.notifications for insert to authenticated
  with check (recipient_id = auth.uid() or is_admin());
