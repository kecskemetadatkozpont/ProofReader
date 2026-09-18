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
