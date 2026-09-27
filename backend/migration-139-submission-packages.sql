-- migration-139-submission-packages.sql
-- Beküldési csomagok: ugyanahhoz a publikációhoz több, egymást követő verzió.
--
-- Mit tárolunk: NEM a nyers ZIP-et (a tárhely fájlonként 50 MB-ot enged, egy valódi
-- csomag ennél nagyobb), hanem a csomag MANIFESTJÉT — fájlonként szerep, méret,
-- ujjlenyomat, és a tartalmi összehasonlításhoz szükséges szöveg (LaTeX-forrás,
-- illetve a PDF-ekből kinyert szöveg). A méretkorlát alatti fájlok bájtjai a
-- project-files tárolóba kerülnek, és a manifest hivatkozik rájuk (`sp` mező).
-- Így két verzió akkor is összehasonlítható, ha a bájtjaik már nincsenek meg.
--
-- A verziószám a publikáción belül folytonos (1, 2, 3…), és az RPC adja ki, hogy
-- párhuzamos feltöltésnél se ütközzön.
--
-- Előfeltétel: schema.sql (projects, role_on), migration-138 (coalesce-os role_on minta).
-- Ellenőrzés: select public.sp_list('<project-uuid>');

create table if not exists submission_packages (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  version      int  not null,
  label        text,                                   -- pl. „2. revízió — Sensors”
  note         text,                                   -- mit tartalmaz ez a kör
  archive_name text,
  archive_size bigint,
  is_revision  boolean not null default false,         -- revíziós kör? (más a kötelező tartalom)
  manifest     jsonb not null default '{}'::jsonb,     -- {root, files:[{path,size,sha,role,kind,text?,nested?,sp?}], bytes, roles}
  stats        jsonb not null default '{}'::jsonb,     -- {files, bytes, stored, skipped, missing:[role…]}
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (project_id, version)
);
create index if not exists sp_project_idx on submission_packages(project_id, version desc);

alter table submission_packages enable row level security;
drop policy if exists sp_read on submission_packages;
-- coalesce KELL: a role_on NULL-t ad, ha a hívónak semmilyen szerepe nincs a publikáción
create policy sp_read on submission_packages for select to authenticated
  using (coalesce(role_on(project_id), '') <> '');

-- ---- lista (manifest nélkül — az a nagy) -----------------------------------
create or replace function public.sp_list(p_project uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(role_on(p_project), '') = '' then raise exception 'Nincs hozzáférésed ehhez a publikációhoz'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'version', s.version, 'label', s.label, 'note', s.note,
      'archive_name', s.archive_name, 'archive_size', s.archive_size,
      'is_revision', s.is_revision, 'stats', s.stats,
      'created_at', s.created_at, 'author', p.name,
      'files', coalesce(jsonb_array_length(s.manifest->'files'), 0))
      order by s.version desc)
    from submission_packages s left join profiles p on p.id = s.created_by
   where s.project_id = p_project), '[]'::jsonb);
end; $$;

-- ---- egy csomag teljes manifestje ------------------------------------------
create or replace function public.sp_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from submission_packages where id = p_id;
  if r is null then raise exception 'Nincs ilyen csomag'; end if;
  if coalesce(role_on(r.project_id), '') = '' then raise exception 'Nincs hozzáférésed'; end if;
  return jsonb_build_object('id', r.id, 'project_id', r.project_id, 'version', r.version,
    'label', r.label, 'note', r.note, 'archive_name', r.archive_name, 'archive_size', r.archive_size,
    'is_revision', r.is_revision, 'manifest', r.manifest, 'stats', r.stats, 'created_at', r.created_at);
end; $$;

-- ---- új verzió ---------------------------------------------------------------
-- A verziószámot itt osztjuk ki (max+1), a sor beszúrásával egy tranzakcióban.
create or replace function public.sp_create(p_project uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v int; new_id uuid;
begin
  if coalesce(role_on(p_project), '') not in ('owner', 'editor') then
    raise exception 'Csak a publikáció tulajdonosa vagy szerkesztője tölthet fel csomagot';
  end if;
  if p_payload is null or jsonb_typeof(p_payload->'manifest') <> 'object' then
    raise exception 'Hiányzó manifest';
  end if;
  select coalesce(max(version), 0) + 1 into v from submission_packages where project_id = p_project;
  insert into submission_packages (project_id, version, label, note, archive_name, archive_size,
                                   is_revision, manifest, stats, created_by)
  values (p_project, v,
          nullif(btrim(coalesce(p_payload->>'label', '')), ''),
          nullif(btrim(coalesce(p_payload->>'note', '')), ''),
          nullif(btrim(coalesce(p_payload->>'archive_name', '')), ''),
          nullif(p_payload->>'archive_size', '')::bigint,
          coalesce((p_payload->>'is_revision')::boolean, false),
          p_payload->'manifest',
          coalesce(p_payload->'stats', '{}'::jsonb),
          auth.uid())
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'version', v);
end; $$;

-- ---- címke / megjegyzés módosítása -------------------------------------------
create or replace function public.sp_update(p_id uuid, p_label text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select project_id into pid from submission_packages where id = p_id;
  if pid is null then raise exception 'Nincs ilyen csomag'; end if;
  if coalesce(role_on(pid), '') not in ('owner', 'editor') then raise exception 'Nincs jogosultság'; end if;
  update submission_packages set label = nullif(btrim(coalesce(p_label, '')), ''),
                                 note  = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;
  return jsonb_build_object('ok', true);
end; $$;

-- ---- törlés ------------------------------------------------------------------
-- A tárolt fájlok útvonalát visszaadjuk, hogy a kliens a blobokat is törölhesse.
create or replace function public.sp_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid; paths jsonb;
begin
  select project_id into pid from submission_packages where id = p_id;
  if pid is null then raise exception 'Nincs ilyen csomag'; end if;
  if coalesce(role_on(pid), '') not in ('owner', 'editor') then raise exception 'Nincs jogosultság'; end if;
  select coalesce(jsonb_agg(f->>'sp'), '[]'::jsonb) into paths
    from submission_packages s, jsonb_array_elements(s.manifest->'files') f
   where s.id = p_id and (f->>'sp') is not null;
  delete from submission_packages where id = p_id;
  return jsonb_build_object('deleted', true, 'storage_paths', paths);
end; $$;

revoke all on function public.sp_list(uuid)                     from public, anon;
revoke all on function public.sp_get(uuid)                      from public, anon;
revoke all on function public.sp_create(uuid, jsonb)            from public, anon;
revoke all on function public.sp_update(uuid, text, text)       from public, anon;
revoke all on function public.sp_delete(uuid)                   from public, anon;
grant execute on function public.sp_list(uuid), public.sp_get(uuid), public.sp_create(uuid, jsonb),
  public.sp_update(uuid, text, text), public.sp_delete(uuid) to authenticated;
