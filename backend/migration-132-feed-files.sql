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
