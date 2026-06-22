-- migration-29: invitation acceptance. Track whether an invited collaborator accepted the share, so the
-- owner can see pending vs. accepted and resend, and the invitee can accept from their notification.

alter table public.project_members add column if not exists accepted_at timestamptz;
comment on column public.project_members.accepted_at is 'When the invitee accepted the share invitation (null = pending).';

-- The invitee accepts their own invitation. manage_members is owner-only, so this runs SECURITY DEFINER and
-- only ever touches the caller's own row for the given project.
create or replace function public.pr_accept_invitation(p_project uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare ts timestamptz;
begin
  update public.project_members
     set accepted_at = coalesce(accepted_at, now())
   where project_id = p_project and user_id = auth.uid()
  returning accepted_at into ts;
  return ts;
end;
$$;
grant execute on function public.pr_accept_invitation(uuid) to authenticated;
