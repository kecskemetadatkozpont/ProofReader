-- =====================================================================
-- migration-129-132-egyben.sql  ·  Publify / Kurzus
-- =====================================================================
--   129 — BIZTONSÁGI: a csapatok feltöltött fájljait csak a csapattársak és az oktató olvashatják
--   130 — Jogosultság-sablonok + tömeges beállítás + kurzus-funkciókulcsok
--   131 — Kurzus-hírfolyam (közlemények, ki látta)
--   132 — Mellékletek a hírfolyamhoz (kép és PDF előnézettel)
--
-- Előfeltétel: a 120-128 már lefutott.
-- Futtatás: Supabase → SQL Editor → beilleszt → Run. Egy tranzakcióban fut, újrafuttatható.
--
-- Ellenőrzés utána:
--   select
--     (select count(*) from information_schema.tables
--       where table_name in ('permission_presets','course_posts','course_post_reads','course_post_files')) as tablak,
--     (select count(*) from permission_presets) as sablonok,
--     (select count(*) from pg_policies where tablename='objects' and policyname='cm_read_team') as fajl_szabaly;
--   -- várt: tablak = 4, sablonok = 4, fajl_szabaly = 1
-- =====================================================================

begin;


-- =====================================================================
-- 129. rész — Csapat-fájlok elzárása a többi csapattól (biztonsági javítás)
-- forrás: migration-129-team-file-isolation.sql
-- =====================================================================

-- migration-129-team-file-isolation.sql
-- BIZTONSÁGI JAVÍTÁS: a csapatok feltöltött fájljai eddig kurzus-szinten voltak olvashatók.
--
-- A 67-es migráció tárolási szabálya így szólt: a 'course-media' tárolóban bárki olvashat
-- bármit, aki a kurzus tagja. Ez a diasoroknál helyes (mindenki nézi az előadást), de a
-- csapatok munkaterénél nem: a `<kurzus>/<feltöltő>/team/…` útvonalon fekvő bizonyítékok és
-- dokumentumok bájtjai így egy másik csapat hallgatójának is letölthetők voltak, sőt a
-- tároló listázásával meg is találhatók. (Az adatbázisban a sorok RLS-e rendben volt: a
-- feladatok, üzenetek, dokumentum-rekordok nem látszottak — csak a fájl maga.)
--
-- Javítás: a 'team' szegmenst tartalmazó útvonalakat kivesszük a kurzus-szintű olvasásból,
-- és külön szabályt kapnak: csak az olvashatja, aki a feltöltővel EGY CSAPATBAN van azon a
-- kurzuson — vagy az oktató.
--
-- Előfeltétel: migration-67 (course-media), 122 (course_team_members).
-- Ellenőrzés: másik csapat tagjaként a fájl letöltése 400/403, a saját csapaté 200.

create or replace function public.shares_team(p_course uuid, p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from course_team_members a
      join course_team_members b on b.team_id = a.team_id
     where a.course_id = p_course and a.user_id = p_other and b.user_id = auth.uid());
$$;
revoke all on function public.shares_team(uuid, uuid) from public, anon;
grant execute on function public.shares_team(uuid, uuid) to authenticated;

-- ---- olvasás -----------------------------------------------------------------
-- 1. kurzus-szintű olvasás MINDENRE, ami nem csapat-fájl (diasorok, órai anyagok).
drop policy if exists cm_read on storage.objects;
create policy cm_read on storage.objects for select to authenticated
  using (bucket_id = 'course-media'
    and coalesce((storage.foldername(name))[3], '') <> 'team'
    and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then course_is_member(((storage.foldername(name))[1])::uuid)
             else false end);

-- 2. csapat-fájl: csak csapattárs vagy oktató.
drop policy if exists cm_read_team on storage.objects;
create policy cm_read_team on storage.objects for select to authenticated
  using (bucket_id = 'course-media'
    and (storage.foldername(name))[3] = 'team'
    and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then ((storage.foldername(name))[2] = auth.uid()::text                       -- a saját feltöltése
                   or shares_team(((storage.foldername(name))[1])::uuid, ((storage.foldername(name))[2])::uuid)
                   or course_is_instructor(((storage.foldername(name))[1])::uuid))
             else false end);

-- A feltöltés és a törlés szabálya változatlan (67-es migráció): feltölteni csak a saját
-- '<kurzus>/<uid>/…' mappájába lehet, törölni a feltöltő és az oktató tud.

-- =====================================================================
-- 130. rész — Jogosultság-sablonok, tömeges beállítás, kurzus-kulcsok
-- forrás: migration-130-permission-presets.sql
-- =====================================================================

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

-- =====================================================================
-- 131. rész — Kurzus-hírfolyam olvasás-visszajelzéssel
-- forrás: migration-131-course-feed.sql
-- =====================================================================

-- migration-131-course-feed.sql
-- Kurzus-hírfolyam: az oktató közleményei + ki olvasta el.
--
-- Az olvasás-visszajelzés szándékosan egyszerű: amikor a bejegyzés megjelenik a hallgató
-- képernyőjén, a kliens jelzi (course_post_read). Ez „látta”, nem „megértette” — a felület
-- is így fogalmaz. Az oktató látja, kinél jelent meg és kinél nem.
--
-- Előfeltétel: migration-66 (courses, course_enrollments, course_is_member/_instructor).
-- Ellenőrzés: select public.course_feed('<course-uuid>') -> 'posts';

create table if not exists course_posts (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references courses(id) on delete cascade,
  author     uuid not null references profiles(id),
  title      text,
  body       text not null,
  kind       text not null default 'info' check (kind in ('info', 'fontos', 'hatarido')),
  pinned     boolean not null default false,
  due_on     date,                                   -- ha határidős közlemény
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cp_course_idx on course_posts(course_id, pinned desc, created_at desc);

create table if not exists course_post_reads (
  post_id uuid not null references course_posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists cpr_post_idx on course_post_reads(post_id);

alter table course_posts      enable row level security;
alter table course_post_reads enable row level security;

drop policy if exists cp_read on course_posts;
create policy cp_read on course_posts for select to authenticated using (course_is_member(course_id));
drop policy if exists cpr_read on course_post_reads;
create policy cpr_read on course_post_reads for select to authenticated
  using (user_id = auth.uid() or course_is_instructor(course_id));
-- írás csak az alábbi RPC-ken

do $$ begin
  alter publication supabase_realtime add table course_posts;   -- új közlemény azonnal megjelenjen
exception when duplicate_object then null; end $$;

-- ---- közlemény írása / törlése (oktató) ------------------------------------
create or replace function public.course_post_save(p_course uuid, p_post jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid; txt text;
begin
  if not course_is_instructor(p_course) then raise exception 'Csak oktató írhat a hírfolyamba'; end if;
  txt := btrim(coalesce(p_post->>'body', ''));
  if length(txt) < 2 then raise exception 'A közlemény szövege üres.'; end if;
  pid := nullif(p_post->>'id', '')::uuid;
  if pid is null then
    insert into course_posts (course_id, author, title, body, kind, pinned, due_on)
    values (p_course, auth.uid(), nullif(btrim(coalesce(p_post->>'title', '')), ''), left(txt, 4000),
            coalesce(nullif(p_post->>'kind', ''), 'info'), coalesce((p_post->>'pinned')::boolean, false),
            nullif(p_post->>'due_on', '')::date)
    returning id into pid;
  else
    update course_posts set
      title = nullif(btrim(coalesce(p_post->>'title', '')), ''),
      body = left(txt, 4000),
      kind = coalesce(nullif(p_post->>'kind', ''), kind),
      pinned = coalesce((p_post->>'pinned')::boolean, pinned),
      due_on = nullif(p_post->>'due_on', '')::date,
      updated_at = now()
     where id = pid and course_id = p_course;
  end if;
  return pid;
end; $$;

create or replace function public.course_post_delete(p_post uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select course_id into cid from course_posts where id = p_post;
  if cid is null or not course_is_instructor(cid) then raise exception 'Nincs jogosultság'; end if;
  delete from course_posts where id = p_post;
end; $$;

-- ---- olvasás jelzése (hallgató) --------------------------------------------
create or replace function public.course_post_read(p_posts uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  insert into course_post_reads (post_id, user_id, course_id)
  select p.id, auth.uid(), p.course_id from course_posts p
   where p.id = any(p_posts) and course_is_member(p.course_id)
  on conflict (post_id, user_id) do nothing;
  get diagnostics n = row_count;
  return n;
end; $$;

-- ---- hírfolyam egy hívásban -------------------------------------------------
-- A hallgató a saját olvasottságát látja; az oktató minden bejegyzésnél azt is,
-- hány hallgatóhoz jutott el, és (a részletekhez) kihez nem.
create or replace function public.course_feed(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare is_instr boolean; total int;
begin
  if not course_is_member(p_course) and not course_is_instructor(p_course) then
    raise exception 'Nem vagy a kurzus résztvevője';
  end if;
  is_instr := course_is_instructor(p_course);
  select count(*) into total from course_enrollments
   where course_id = p_course and role = 'hallgato' and status = 'active';
  return jsonb_build_object(
    'is_instructor', is_instr,
    'students', total,
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'title', p.title, 'body', p.body, 'kind', p.kind, 'pinned', p.pinned,
        'due_on', p.due_on, 'created_at', p.created_at, 'updated_at', p.updated_at,
        'author', a.name,
        'read_by_me', exists (select 1 from course_post_reads r where r.post_id = p.id and r.user_id = auth.uid()),
        'reads', (select count(*) from course_post_reads r
                    join course_enrollments e on e.user_id = r.user_id and e.course_id = p_course and e.role = 'hallgato'
                   where r.post_id = p.id))
        order by p.pinned desc, p.created_at desc)
        from course_posts p left join profiles a on a.id = p.author
       where p.course_id = p_course), '[]'::jsonb),
    'unread', (select count(*) from course_posts p
                where p.course_id = p_course
                  and not exists (select 1 from course_post_reads r where r.post_id = p.id and r.user_id = auth.uid())));
end; $$;

-- Ki látta és ki nem — csak az oktatónak, bejegyzésenként.
create or replace function public.course_post_readers(p_post uuid)
returns table (user_id uuid, name text, read_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select course_id into cid from course_posts where id = p_post;
  if cid is null or not course_is_instructor(cid) then raise exception 'Nincs jogosultság'; end if;
  return query
    select e.user_id, p.name, r.read_at
      from course_enrollments e
      join profiles p on p.id = e.user_id
      left join course_post_reads r on r.post_id = p_post and r.user_id = e.user_id
     where e.course_id = cid and e.role = 'hallgato' and e.status = 'active'
     order by (r.read_at is null), p.name;
end; $$;

revoke all on function public.course_post_save(uuid, jsonb) from public, anon;
revoke all on function public.course_post_delete(uuid)      from public, anon;
revoke all on function public.course_post_read(uuid[])      from public, anon;
revoke all on function public.course_feed(uuid)             from public, anon;
revoke all on function public.course_post_readers(uuid)     from public, anon;
grant execute on function public.course_post_save(uuid, jsonb), public.course_post_delete(uuid),
  public.course_post_read(uuid[]), public.course_feed(uuid), public.course_post_readers(uuid) to authenticated;

-- =====================================================================
-- 132. rész — Mellékletek a hírfolyamhoz (kép/PDF előnézettel)
-- forrás: migration-132-feed-files.sql
-- =====================================================================

-- migration-132-feed-files.sql
-- Melléklet a hírfolyam bejegyzéseihez: fájl vagy link, képeknél és PDF-nél előnézettel.
--
-- A fájlok a meglévő 'course-media' tárolóba kerülnek, '<kurzus>/<feltöltő>/feed/…' útvonalon.
-- Ez kurzus-szinten olvasható (67-es migráció) — a hírfolyamnál épp ez a helyes: a közlemény
-- és a melléklete a kurzus minden résztvevőjének szól. (A csapat-fájlokat a 129-es migráció
-- zárta csapat-szintre; az a '…/team/…' útvonalra vonatkozik, ezt nem érinti.)
--
-- Előfeltétel: migration-131 (course_posts).
-- Ellenőrzés: select public.course_feed('<course-uuid>') -> 'posts' -> 0 -> 'files';

create table if not exists course_post_files (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references course_posts(id) on delete cascade,
  course_id    uuid not null references courses(id) on delete cascade,
  kind         text not null default 'file' check (kind in ('file', 'link')),
  name         text not null,
  storage_path text,
  url          text,
  size         bigint,
  mime         text,
  uploaded_by  uuid not null references profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists cpf_post_idx on course_post_files(post_id, created_at);
alter table course_post_files enable row level security;
drop policy if exists cpf_read on course_post_files;
create policy cpf_read on course_post_files for select to authenticated using (course_is_member(course_id));

create or replace function public.course_post_file_add(p_post uuid, p_kind text, p_name text,
  p_path text default null, p_url text default null, p_size bigint default null, p_mime text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; fid uuid;
begin
  select course_id into cid from course_posts where id = p_post;
  if cid is null or not course_is_instructor(cid) then raise exception 'Csak oktató csatolhat a hírfolyamhoz'; end if;
  if p_kind not in ('file', 'link') then raise exception 'Ismeretlen típus'; end if;
  if p_kind = 'file' and coalesce(p_path, '') = '' then raise exception 'Hiányzik a fájl útvonala'; end if;
  if p_kind = 'link' and coalesce(p_url, '') !~ '^https?://' then raise exception 'A link http(s) címmel kezdődjön.'; end if;
  insert into course_post_files (post_id, course_id, kind, name, storage_path, url, size, mime, uploaded_by)
  values (p_post, cid, p_kind, left(btrim(coalesce(p_name, 'melléklet')), 200), p_path, p_url, p_size, p_mime, auth.uid())
  returning id into fid;
  return fid;
end; $$;

create or replace function public.course_post_file_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f record;
begin
  select * into f from course_post_files where id = p_id;
  if f is null then return jsonb_build_object('deleted', false); end if;
  if not course_is_instructor(f.course_id) then raise exception 'Nincs jogosultság'; end if;
  delete from course_post_files where id = p_id;
  return jsonb_build_object('deleted', true, 'path', f.storage_path);
end; $$;

-- a hírfolyam a mellékletekkel együtt
create or replace function public.course_feed(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare is_instr boolean; total int;
begin
  if not course_is_member(p_course) and not course_is_instructor(p_course) then
    raise exception 'Nem vagy a kurzus résztvevője';
  end if;
  is_instr := course_is_instructor(p_course);
  select count(*) into total from course_enrollments
   where course_id = p_course and role = 'hallgato' and status = 'active';
  return jsonb_build_object(
    'is_instructor', is_instr,
    'students', total,
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'title', p.title, 'body', p.body, 'kind', p.kind, 'pinned', p.pinned,
        'due_on', p.due_on, 'created_at', p.created_at, 'updated_at', p.updated_at,
        'author', a.name,
        'read_by_me', exists (select 1 from course_post_reads r where r.post_id = p.id and r.user_id = auth.uid()),
        'reads', (select count(*) from course_post_reads r
                    join course_enrollments e on e.user_id = r.user_id and e.course_id = p_course and e.role = 'hallgato'
                   where r.post_id = p.id),
        'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'name', f.name,
                                                               'storage_path', f.storage_path, 'url', f.url,
                                                               'size', f.size, 'mime', f.mime, 'created_at', f.created_at)
                                            order by f.created_at)
                             from course_post_files f where f.post_id = p.id), '[]'::jsonb))
        order by p.pinned desc, p.created_at desc)
        from course_posts p left join profiles a on a.id = p.author
       where p.course_id = p_course), '[]'::jsonb),
    'unread', (select count(*) from course_posts p
                where p.course_id = p_course
                  and not exists (select 1 from course_post_reads r where r.post_id = p.id and r.user_id = auth.uid())));
end; $$;

revoke all on function public.course_post_file_add(uuid, text, text, text, text, bigint, text) from public, anon;
revoke all on function public.course_post_file_delete(uuid) from public, anon;
grant execute on function public.course_post_file_add(uuid, text, text, text, text, bigint, text),
  public.course_post_file_delete(uuid), public.course_feed(uuid) to authenticated;

commit;
