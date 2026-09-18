-- migration-127-fix-comments-list.sql
-- Javítás: a team_task_comments_list a „column reference id is ambiguous” hibára futott,
-- mert a RETURNS TABLE „id” kimeneti mezője ütközött a team_tasks.id oszloppal a
-- `where id = p_task` feltételben. A tábla nevével minősítve egyértelmű.
--
-- Előfeltétel: migration-126.
-- Ellenőrzés: csapattagként `select * from team_task_comments_list('<task-uuid>');` → sorok, nem hiba.

create or replace function public.team_task_comments_list(p_task uuid)
returns table (id uuid, author uuid, author_name text, body text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare k record;
begin
  select * into k from team_tasks t where t.id = p_task;
  if k is null or not team_can_read(k.team_id) then raise exception 'Nincs hozzáférésed'; end if;
  return query
    select c.id, c.author, p.name, c.body, c.created_at
      from team_task_comments c left join profiles p on p.id = c.author
     where c.task_id = p_task order by c.created_at;
end; $$;
revoke all on function public.team_task_comments_list(uuid) from public, anon;
grant execute on function public.team_task_comments_list(uuid) to authenticated;
