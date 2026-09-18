-- migration-130-permission-presets.sql
-- Jogosultság-kezelés: szerepkör-sablonok, tömeges beállítás és a kurzus-modul kulcsai.
--
-- Eddig a profiles.features jsonb-t felhasználónként, kulcsonként kellett kattintgatni.
-- 474 hallgatónál ez használhatatlan, ezért:
--   * sablonok (permission_presets): egy kattintással a teljes jogosultság-készlet,
--   * tömeges műveletek admin RPC-kkel (sablon, egy kulcs, napi AI-keret),
--   * a kurzus-modul funkciói is kulcsot kapnak, hogy csoportonként szabályozhatók legyenek.
--
-- Előfeltétel: migration-49 (feature_catalog, profiles.features), 122-128 (kurzus-modul).
-- Ellenőrzés: select name from permission_presets order by sort;   -- 4 sor

-- ---- 1. új kulcsok a kurzus-modulhoz ----------------------------------------
insert into feature_catalog (key, label, category, default_on, enforced, sort) values
  ('course_teams',     'Kurzus — csapatok',            'page', true,  false, 260),
  ('course_team_room', 'Kurzus — csapat-munkatér',     'page', true,  false, 262),
  ('course_team_chat', 'Kurzus — csapat-chat',         'ai',   true,  true,  264),
  ('course_docs',      'Kurzus — dokumentumtár',       'ai',   true,  true,  266)
on conflict (key) do nothing;

-- ---- 2. sablonok -------------------------------------------------------------
create table if not exists permission_presets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  features    jsonb not null default '{}'::jsonb,   -- {kulcs: true|false}; ami nincs benne, az marad az alapértelmezett
  ai_daily_cap int,                                  -- null = változatlan
  sort        int not null default 100,
  created_at  timestamptz not null default now()
);
alter table permission_presets enable row level security;
drop policy if exists pp_read on permission_presets;
create policy pp_read on permission_presets for select to authenticated using (is_admin());
drop policy if exists pp_write on permission_presets;
create policy pp_write on permission_presets for all to authenticated using (is_admin()) with check (is_admin());

-- Alap sablonok. A „Hallgató” szándékosan zár le minden AI-funkciót: 474 fős kurzusnál
-- ez valódi költség, és a hallgatónak a kurzus felülete elég.
insert into permission_presets (name, description, features, ai_daily_cap, sort) values
  ('Hallgató',
   'Csak a Kurzus felület: előadás, csapat, labor. Kutatói oldalak és AI-funkciók nélkül.',
   jsonb_build_object('page_course', true, 'course_teams', true, 'course_team_room', true,
     'course_team_chat', true, 'course_docs', true, 'course_mcp', false,
     'page_research', false, 'page_session', false, 'page_memory', false, 'page_media', false,
     'page_submissions', false, 'page_compare', false, 'page_phd', false, 'page_publications', false,
     'page_kanban', false, 'research_chat_ideas', false, 'literature_study', false,
     'journal_matching', false, 'research_ai_writing', false, 'ai_writing_assist', false,
     'mtmt_sync', false, 'protocol_runner', false, 'research_web_search', false, 'research_agents', false),
   20, 10),
  ('Kutató',
   'A megszokott kutatói készlet: Research, Chat, Irodalom, Memória, Média, publikációk.',
   jsonb_build_object('page_research', true, 'page_session', true, 'page_memory', true, 'page_media', true,
     'page_compare', true, 'page_publications', true, 'page_kanban', true, 'page_phd', true,
     'research_chat_ideas', true, 'literature_study', true, 'journal_matching', true,
     'research_ai_writing', true, 'ai_writing_assist', true, 'mtmt_sync', true,
     'research_web_search', false, 'research_agents', false, 'protocol_runner', false),
   null, 20),
  ('Oktató',
   'Kutatói készlet + a kurzus minden funkciója (élő előadás, névsor, csapatok, labor).',
   jsonb_build_object('page_research', true, 'page_session', true, 'page_memory', true, 'page_media', true,
     'page_compare', true, 'page_publications', true, 'page_kanban', true, 'page_phd', true,
     'page_course', true, 'course_teams', true, 'course_team_room', true, 'course_team_chat', true,
     'course_docs', true, 'course_mcp', true, 'research_chat_ideas', true, 'literature_study', true,
     'journal_matching', true, 'research_ai_writing', true, 'ai_writing_assist', true, 'mtmt_sync', true),
   null, 30),
  ('Csak olvasó',
   'Böngészhet és megnézhet, de AI-funkciót nem indít. Vendégeknek, bírálóknak.',
   jsonb_build_object('page_research', true, 'page_publications', true, 'page_compare', true,
     'page_course', false, 'page_session', false, 'page_memory', false, 'page_media', false,
     'research_chat_ideas', false, 'literature_study', false, 'journal_matching', false,
     'research_ai_writing', false, 'ai_writing_assist', false, 'protocol_runner', false,
     'research_web_search', false, 'research_agents', false, 'mtmt_sync', false),
   0, 40)
on conflict (name) do nothing;

-- ---- 3. tömeges műveletek (admin) -------------------------------------------
-- Mindegyik SECURITY DEFINER, de is_admin() nélkül azonnal elutasít: a profiles
-- táblán nincs nem-admin UPDATE policy, és a guard_profile_update trigger is véd.
create or replace function public.admin_apply_preset(p_users uuid[], p_preset uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr record; n int := 0;
begin
  if not is_admin() then raise exception 'Csak adminisztrátor'; end if;
  select * into pr from permission_presets where id = p_preset;
  if pr is null then raise exception 'Nincs ilyen sablon'; end if;
  update profiles
     set features = coalesce(features, '{}'::jsonb) || pr.features,
         ai_daily_cap = coalesce(pr.ai_daily_cap, ai_daily_cap),
         can_workflows = coalesce((pr.features->>'session_workflow_mode')::boolean, can_workflows),
         can_figures   = coalesce((pr.features->>'paper_figure')::boolean, can_figures)
   where id = any(p_users) and role <> 'admin';
  get diagnostics n = row_count;
  return jsonb_build_object('updated', n, 'preset', pr.name);
end; $$;

-- p_value = null → visszaáll a katalógus alapértelmezésére (a kulcs kikerül a jsonb-ből)
create or replace function public.admin_set_feature(p_users uuid[], p_key text, p_value boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not is_admin() then raise exception 'Csak adminisztrátor'; end if;
  if not exists (select 1 from feature_catalog where key = p_key) then raise exception 'Ismeretlen funkció: %', p_key; end if;
  if p_value is null then
    update profiles set features = coalesce(features, '{}'::jsonb) - p_key where id = any(p_users) and role <> 'admin';
  else
    update profiles set features = coalesce(features, '{}'::jsonb) || jsonb_build_object(p_key, p_value)
     where id = any(p_users) and role <> 'admin';
  end if;
  get diagnostics n = row_count;
  -- a két örökölt oszlop külön él (migration-49)
  if p_key = 'session_workflow_mode' then
    update profiles set can_workflows = coalesce(p_value, can_workflows) where id = any(p_users) and role <> 'admin';
  elsif p_key = 'paper_figure' then
    update profiles set can_figures = coalesce(p_value, can_figures) where id = any(p_users) and role <> 'admin';
  end if;
  return jsonb_build_object('updated', n, 'key', p_key, 'value', p_value);
end; $$;

create or replace function public.admin_set_cap(p_users uuid[], p_cap int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not is_admin() then raise exception 'Csak adminisztrátor'; end if;
  if p_cap is not null and (p_cap < 0 or p_cap > 5000) then raise exception 'A napi keret 0 és 5000 között legyen'; end if;
  update profiles set ai_daily_cap = p_cap where id = any(p_users) and role <> 'admin';
  get diagnostics n = row_count;
  return jsonb_build_object('updated', n, 'cap', p_cap);
end; $$;

create or replace function public.admin_set_status(p_users uuid[], p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not is_admin() then raise exception 'Csak adminisztrátor'; end if;
  if p_status not in ('approved', 'pending', 'suspended', 'rejected') then raise exception 'Ismeretlen állapot'; end if;
  update profiles set status = p_status where id = any(p_users) and role <> 'admin';
  get diagnostics n = row_count;
  return jsonb_build_object('updated', n, 'status', p_status);
end; $$;

-- Áttekintés: ki mit ér el ténylegesen (alapértelmezés + egyedi beállítás összeolvasva).
create or replace function public.admin_permissions_overview() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Csak adminisztrátor'; end if;
  return jsonb_build_object(
    'catalog', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'label', label, 'category', category,
                                                             'default_on', default_on, 'enforced', enforced, 'sort', sort)
                                          order by sort) from feature_catalog), '[]'::jsonb),
    'presets', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description,
                                                             'features', features, 'ai_daily_cap', ai_daily_cap)
                                          order by sort) from permission_presets), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'email', p.email,
                                                           'status', p.status, 'role', p.role, 'affiliation', p.affiliation,
                                                           'is_student', p.is_student, 'features', coalesce(p.features, '{}'::jsonb),
                                                           'ai_daily_cap', p.ai_daily_cap,
                                                           'can_workflows', p.can_workflows, 'can_figures', p.can_figures)
                                        order by p.name) from profiles p), '[]'::jsonb));
end; $$;

revoke all on function public.admin_apply_preset(uuid[], uuid)      from public, anon;
revoke all on function public.admin_set_feature(uuid[], text, boolean) from public, anon;
revoke all on function public.admin_set_cap(uuid[], int)            from public, anon;
revoke all on function public.admin_set_status(uuid[], text)        from public, anon;
revoke all on function public.admin_permissions_overview()          from public, anon;
grant execute on function public.admin_apply_preset(uuid[], uuid), public.admin_set_feature(uuid[], text, boolean),
  public.admin_set_cap(uuid[], int), public.admin_set_status(uuid[], text), public.admin_permissions_overview()
to authenticated;

-- ---- 4. a két új kurzus-kulcs kikényszerítése a szerveren --------------------
create or replace function public.team_message_send(p_team uuid, p_body text, p_task uuid default null, p_meta jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; mid uuid; txt text;
begin
  if not team_can_write(p_team) then raise exception 'Csak a csapat tagjai (és az oktató) írhatnak ide'; end if;
  if not is_feature_enabled('course_team_chat') then raise exception 'A csapat-chat a fiókodon ki van kapcsolva.'; end if;
  txt := btrim(coalesce(p_body, ''));
  if txt = '' then raise exception 'Üres üzenet.'; end if;
  select course_id into cid from course_teams where id = p_team;
  insert into team_messages (team_id, course_id, author, body, task_id, meta)
  values (p_team, cid, auth.uid(), left(txt, 4000), p_task, coalesce(p_meta, '{}'::jsonb))
  returning id into mid;
  return mid;
end; $$;

create or replace function public.team_doc_add(p_team uuid, p_kind text, p_name text, p_note text default null,
  p_path text default null, p_url text default null, p_size bigint default null, p_mime text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; did uuid;
begin
  if not team_can_write(p_team) then raise exception 'Csak a csapat tagjai (és az oktató) tölthetnek fel'; end if;
  if not is_feature_enabled('course_docs') then raise exception 'A dokumentumtár a fiókodon ki van kapcsolva.'; end if;
  if p_kind not in ('file', 'link') then raise exception 'Ismeretlen típus'; end if;
  if p_kind = 'file' and coalesce(p_path, '') = '' then raise exception 'Hiányzik a fájl útvonala'; end if;
  if p_kind = 'link' and coalesce(p_url, '') !~ '^https?://' then raise exception 'A link http(s) címmel kezdődjön.'; end if;
  select course_id into cid from course_teams where id = p_team;
  insert into team_docs (team_id, course_id, kind, name, note, storage_path, url, size, mime, uploaded_by)
  values (p_team, cid, p_kind, left(btrim(coalesce(p_name, 'dokumentum')), 200),
          nullif(btrim(coalesce(p_note, '')), ''), p_path, p_url, p_size, p_mime, auth.uid())
  returning id into did;
  return did;
end; $$;
