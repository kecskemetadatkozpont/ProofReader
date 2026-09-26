-- migration-138-publication-research-link.sql
-- Egy publikáció (LaTeX-projekt) melyik kutatási projekthez tartozik.
--
-- Miért külön OSZLOP és nem a projects.data blobba írjuk: a pr_save_project a data-t
-- egészében felülírja (csak az annotations-t őrzi meg), tehát egy régebbi kliens mentése
-- csendben letörölné a kapcsolatot — ugyanaz a hibaosztály, mint amit a 37-es migráció
-- javított az annotációknál. Az oszlopot csak az itteni RPC írja, a mentés sosem.
--
-- Mit ad:
--   pr_create_publication   — a Research → Írás fülön „Új publikáció” (kártya) létrehozása
--   pr_set_research_link    — meglévő publikáció csatolása / leválasztása
--   pr_research_publications— a kutatási projekthez tartozó publikációk (kártyákhoz)
--   pr_publication_links    — a Publikációk oldal kártyáira: önálló vagy melyik kutatáshoz tartozik
--
-- Láthatóság: a kapcsolat két, egymástól független jogosultsági világot köt össze. A kutatási
-- projekt tagjai LÁTJÁK a hozzá csatolt publikáció címét és állapotát (ezért csatolta oda valaki),
-- de megnyitni csak az tudja, aki magán a publikáción tulajdonos/szerkesztő — ezt a can_open mondja meg.
-- A másik irányban a publikáció kártyáján a kutatási projekt NEVE csak akkor jelenik meg,
-- ha a néző azt a kutatási projektet is olvashatja; különben csak annyi, hogy tartozik valahova.
--
-- Előfeltétel: schema.sql (projects, role_on), migration-11/74/89 (research_projects, research_can_*).
-- Ellenőrzés: select public.pr_publication_links();

alter table projects add column if not exists research_project_id uuid
  references research_projects(id) on delete set null;
create index if not exists projects_research_idx on projects(research_project_id)
  where research_project_id is not null;

-- ---- új publikáció egy kutatási projektből ----------------------------------
-- A kezdő tartalom szándékosan ugyanaz, amit a kliens store.js blankFiles()-a ad, hogy a
-- szerkesztő pontosan úgy nyissa meg, mint egy a Publikációk oldalon létrehozott projektet.
create or replace function public.pr_create_publication(p_research uuid, p_title text, p_journal text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare new_id uuid := gen_random_uuid(); t text; j text; body text; now_ms bigint;
begin
  if auth.uid() is null then raise exception 'Bejelentkezés kell'; end if;
  if p_research is null or not research_can_write_project(p_research) then
    raise exception 'Ehhez a kutatási projekthez nincs írási jogosultságod';
  end if;
  t := nullif(btrim(coalesce(p_title, '')), '');
  if t is null then t := 'Névtelen publikáció'; end if;
  t := left(t, 200);
  j := nullif(btrim(coalesce(p_journal, '')), '');
  now_ms := (extract(epoch from now()) * 1000)::bigint;
  body := '\documentclass[11pt]{article}' || chr(10) || '\usepackage{amsmath}' || chr(10)
       || '\usepackage{graphicx}' || chr(10) || chr(10)
       || '\title{' || replace(t, '\', '') || '}' || chr(10) || '\author{}' || chr(10)
       || '\date{\today}' || chr(10) || chr(10) || '\begin{document}' || chr(10) || '\maketitle' || chr(10) || chr(10)
       || '\section{Bevezetés}' || chr(10) || 'Ide írj.' || chr(10) || chr(10) || '\end{document}' || chr(10);

  insert into projects (id, owner_id, title, data, research_project_id, updated_at)
  values (new_id, auth.uid(), t,
    jsonb_build_object(
      'id', new_id::text, 'title', t, 'ownerId', auth.uid()::text,
      'created', now_ms, 'updated', now_ms, 'idx', 0,
      'active', 'main.tex', 'order', jsonb_build_array('main.tex'), 'folders', '[]'::jsonb,
      'files', jsonb_build_object('main.tex', jsonb_build_object('type', 'tex', 'content', body)),
      'journal', coalesce(j, ''), 'status', 'Drafting',
      'members', '[]'::jsonb, 'activity', '[]'::jsonb, 'versions', '[]'::jsonb,
      'annotations', '[]'::jsonb, 'link', jsonb_build_object('enabled', false, 'role', 'viewer')),
    p_research, now());

  return jsonb_build_object('project_id', new_id, 'title', t, 'research_project_id', p_research);
end; $$;

-- ---- meglévő publikáció csatolása / leválasztása ----------------------------
create or replace function public.pr_set_research_link(p_project uuid, p_research uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r_title text;
begin
  -- coalesce KELL: a role_on NULL-t ad, ha a hívónak semmilyen szerepe nincs a publikáción,
  -- és a `NULL not in (...)` nem igaz → a védelem nyitva maradna (lásd a lentebbi 37-es javítást).
  if coalesce(role_on(p_project), '') not in ('owner', 'editor') then
    raise exception 'Csak a publikáció tulajdonosa vagy szerkesztője kötheti kutatási projekthez';
  end if;
  if p_research is not null and not research_can_read_project(p_research) then
    raise exception 'Ehhez a kutatási projekthez nincs hozzáférésed';
  end if;
  update projects set research_project_id = p_research where id = p_project;
  if p_research is not null then select title into r_title from research_projects where id = p_research; end if;
  return jsonb_build_object('project_id', p_project, 'research_project_id', p_research, 'research_title', r_title);
end; $$;

-- ---- a kutatási projekthez tartozó publikációk (Írás fül kártyái) -----------
create or replace function public.pr_research_publications(p_research uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not research_can_read_project(p_research) then raise exception 'Nincs hozzáférésed'; end if;
  return coalesce((select jsonb_agg(x order by x->>'updated_at' desc) from (
    select jsonb_build_object(
      'project_id', p.id,
      'title', coalesce(nullif(btrim(p.title), ''), 'Névtelen publikáció'),
      'status', coalesce(p.data->>'status', 'Drafting'),
      'journal', nullif(p.data->>'journal', ''),
      'files', coalesce(jsonb_array_length(p.data->'order'), 0),
      'updated_at', p.updated_at,
      'owner_id', p.owner_id,
      'owner_name', o.name,
      'can_open', role_on(p.id) is not null,
      'can_unlink', coalesce(role_on(p.id) in ('owner', 'editor'), false)
    ) as x
    from projects p left join profiles o on o.id = p.owner_id
    where p.research_project_id = p_research and p.deleted_at is null
  ) s), '[]'::jsonb);
end; $$;

-- ---- a Publikációk oldal kártyáihoz: hova tartoznak a saját publikációim ----
-- A kutatási projekt nevét csak akkor adjuk vissza, ha a néző azt is olvashatja.
create or replace function public.pr_publication_links()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'project_id', p.id,
      'research_project_id', p.research_project_id,
      'research_title', case when research_can_read_project(p.research_project_id)
                             then (select r.title from research_projects r where r.id = p.research_project_id)
                        end))
    from projects p
    where p.deleted_at is null
      and p.research_project_id is not null
      and (p.owner_id = auth.uid()
           or exists (select 1 from project_members m where m.project_id = p.id and m.user_id = auth.uid()))
  ), '[]'::jsonb);
end; $$;

revoke all on function public.pr_create_publication(uuid, text, text)   from public, anon;
revoke all on function public.pr_set_research_link(uuid, uuid)          from public, anon;
revoke all on function public.pr_research_publications(uuid)            from public, anon;
revoke all on function public.pr_publication_links()                    from public, anon;
grant execute on function public.pr_create_publication(uuid, text, text), public.pr_set_research_link(uuid, uuid),
  public.pr_research_publications(uuid), public.pr_publication_links() to authenticated;

-- ============================================================================
-- BIZTONSÁGI JAVÍTÁS a 37-es migrációhoz (ugyanaz a NULL-csapda, amit fentebb elkerültünk)
--
-- A migration-37 három SECURITY DEFINER függvénye így védett:  role_on(p) not in ('owner','editor')
-- Ha a hívónak SEMMILYEN szerepe nincs a projekten, a role_on NULL-t ad, a `NULL not in (...)` pedig
-- NULL — az `if` nem sül el, a függvény pedig továbbmegy és ír. Vagyis aki ismer egy projekt-azonosítót
-- (pl. korábban meg volt neki osztva, vagy egy linkből/értesítésből megszerezte), az felülírhatta
-- a publikáció teljes tartalmát vagy az annotációit. A migration-27 helyesen `is null or ...`-t használ.
--
-- Itt csak a védőfeltételt cseréljük coalesce-osra, a törzsek változatlanok.
-- Ellenőrzés utána (idegen azonosítóval hívva 42501-et kell adnia):
--   select public.pr_save_project('<idegen-project-uuid>', auth.uid(), '{}'::jsonb, 'x', null);
-- ============================================================================

create or replace function public.pr_upsert_annotation(p_project uuid, p_ann jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare anns jsonb; found boolean; aid text;
begin
  if coalesce(public.role_on(p_project), '') not in ('owner','editor','commenter') then
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

create or replace function public.pr_delete_annotation(p_project uuid, p_ann_id text) returns void
language plpgsql security definer set search_path = public as $$
declare anns jsonb;
begin
  if coalesce(public.role_on(p_project), '') not in ('owner','editor','commenter') then
    raise exception 'no annotation access to project %', p_project using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into anns
    from jsonb_array_elements(coalesce((select data->'annotations' from public.projects where id = p_project), '[]'::jsonb)) e
    where e->>'id' <> p_ann_id;
  update public.projects set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('annotations', anns), updated_at = now() where id = p_project;
end; $$;

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
    if coalesce(public.role_on(p_id), '') not in ('owner','editor') then raise exception 'no write access to project %', p_id using errcode = '42501'; end if;
    update public.projects set
      data = (coalesce(p_data, '{}'::jsonb) - 'annotations') || jsonb_build_object('annotations', ex_anns),
      title = coalesce(p_title, title),
      -- only the owner can soft-delete/restore; an editor's save preserves the existing deleted_at
      deleted_at = case when public.role_on(p_id) = 'owner' then p_deleted_at else deleted_at end,
      updated_at = now()
    where id = p_id;
  end if;
end; $$;
