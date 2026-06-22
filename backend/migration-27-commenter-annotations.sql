-- migration-27: let a 'commenter' collaborator actually save comments/todos.
-- Annotations live in projects.data, and update_projects RLS only allows owner/editor — so a commenter's
-- save was silently dropped. This SECURITY DEFINER RPC writes ONLY data->annotations, gated by role_on so
-- owner/editor/commenter may call it (nothing else), without broadening the general projects UPDATE policy.
create or replace function public.pr_save_annotations(p_project uuid, p_annotations jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.role_on(p_project) is null or public.role_on(p_project) not in ('owner', 'editor', 'commenter') then
    raise exception 'no annotation access to project %', p_project using errcode = '42501';
  end if;
  update public.projects
     set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('annotations', coalesce(p_annotations, '[]'::jsonb)),
         updated_at = now()
   where id = p_project and deleted_at is null;
end;
$$;
revoke all on function public.pr_save_annotations(uuid, jsonb) from public;
grant execute on function public.pr_save_annotations(uuid, jsonb) to authenticated;
