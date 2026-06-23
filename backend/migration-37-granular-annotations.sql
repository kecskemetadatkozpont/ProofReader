-- Fix collaborative clobbering: annotations are edited GRANULARLY (per-id), and the whole-project save
-- preserves the server's annotations instead of overwriting the whole array (the root of "rapid comments/
-- to-dos overwrite each other"). All SECURITY DEFINER + role_on-gated; the function owner bypasses RLS, the
-- internal role_on(auth.uid()) check enforces access.

-- upsert ONE annotation into projects.data.annotations by its id (replace in place, else append) — concurrent
-- callers each touch only their own annotation, so no last-write-wins on the array.
create or replace function public.pr_upsert_annotation(p_project uuid, p_ann jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare anns jsonb; found boolean; aid text;
begin
  if public.role_on(p_project) not in ('owner','editor','commenter') then
    raise exception 'no annotation access to project %', p_project using errcode = '42501';
  end if;
  aid := p_ann->>'id';
  select coalesce(data->'annotations', '[]'::jsonb) into anns from public.projects where id = p_project and deleted_at is null;
  if anns is null then anns := '[]'::jsonb; end if;
  select coalesce(jsonb_agg(case when e->>'id' = aid then p_ann else e end), '[]'::jsonb),
         coalesce(bool_or(e->>'id' = aid), false)
    into anns, found
    from jsonb_array_elements(anns) e;
  if not found then anns := anns || jsonb_build_array(p_ann); end if;
  update public.projects set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('annotations', anns), updated_at = now() where id = p_project;
end; $$;

-- remove ONE annotation by id.
create or replace function public.pr_delete_annotation(p_project uuid, p_ann_id text) returns void
language plpgsql security definer set search_path = public as $$
declare anns jsonb;
begin
  if public.role_on(p_project) not in ('owner','editor','commenter') then
    raise exception 'no annotation access to project %', p_project using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into anns
    from jsonb_array_elements(coalesce((select data->'annotations' from public.projects where id = p_project), '[]'::jsonb)) e
    where e->>'id' <> p_ann_id;
  update public.projects set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('annotations', anns), updated_at = now() where id = p_project;
end; $$;

-- save the WHOLE project (doc/files/members/etc.) but KEEP the server's annotations array — so a debounced
-- full-project save never clobbers comments/to-dos that another collaborator added meanwhile. Insert if new
-- (caller becomes owner); update if it exists (owner/editor only).
create or replace function public.pr_save_project(p_id uuid, p_owner uuid, p_data jsonb, p_title text, p_deleted_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare ex_id uuid; ex_anns jsonb;
begin
  select id, coalesce(data->'annotations', '[]'::jsonb) into ex_id, ex_anns from public.projects where id = p_id;
  if ex_id is null then
    if p_owner <> auth.uid() then raise exception 'cannot create a project for another owner' using errcode = '42501'; end if;
    insert into public.projects(id, owner_id, title, data, deleted_at, updated_at)
      values (p_id, p_owner, coalesce(p_title, 'Untitled project'), coalesce(p_data, '{}'::jsonb), p_deleted_at, now());
  else
    if public.role_on(p_id) not in ('owner','editor') then raise exception 'no write access to project %', p_id using errcode = '42501'; end if;
    update public.projects set
      data = (coalesce(p_data, '{}'::jsonb) - 'annotations') || jsonb_build_object('annotations', ex_anns),
      title = coalesce(p_title, title),
      -- only the owner can soft-delete/restore; an editor's save preserves the existing deleted_at
      deleted_at = case when public.role_on(p_id) = 'owner' then p_deleted_at else deleted_at end,
      updated_at = now()
    where id = p_id;
  end if;
end; $$;

revoke all on function public.pr_upsert_annotation(uuid, jsonb) from public;
revoke all on function public.pr_delete_annotation(uuid, text) from public;
revoke all on function public.pr_save_project(uuid, uuid, jsonb, text, timestamptz) from public;
grant execute on function public.pr_upsert_annotation(uuid, jsonb) to authenticated;
grant execute on function public.pr_delete_annotation(uuid, text) to authenticated;
grant execute on function public.pr_save_project(uuid, uuid, jsonb, text, timestamptz) to authenticated;
