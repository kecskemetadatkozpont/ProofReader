-- migration-137-team-github.sql
-- GitHub-kapcsolat a csapatoknak: melyik repóban dolgoznak, és ki mit tett hozzá.
--
-- Hogyan szinkronizál: a böngésző kéri le a GitHub nyilvános API-jából a commitokat
-- (token nélkül, ezért NYILVÁNOS repóval működik), és ez az RPC írja be őket. Így nincs
-- szerveroldali titok, és nem kell külön háttérfolyamat. A szinkron a munkatér megnyitásakor
-- és a „Szinkronizálás” gombbal fut, legfeljebb 10 percenként.
--
-- Ki kihez tartozik: a commit szerzőjének GitHub-felhasználóneve alapján. A tag a saját
-- nevét egyszer megadja (course_team_members.github_login), utána minden commitja hozzá kötődik.
-- Aminek nincs gazdája, az „nem azonosított” marad — nem tippelünk e-mail alapján.
--
-- Előfeltétel: migration-122 (csapatok), 125 (munkatér).
-- Ellenőrzés: select public.team_repo_state('<team-uuid>');

alter table course_teams add column if not exists repo_url       text;
alter table course_teams add column if not exists repo_synced_at timestamptz;
alter table course_team_members add column if not exists github_login text;

create table if not exists team_commits (
  team_id      uuid not null references course_teams(id) on delete cascade,
  course_id    uuid not null references courses(id) on delete cascade,
  sha          text not null,
  author_login text,
  author_name  text,
  message      text,
  url          text,
  committed_at timestamptz,
  matched_user uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (team_id, sha)
);
create index if not exists tc_team_idx on team_commits(team_id, committed_at desc);
create index if not exists tc_user_idx on team_commits(team_id, matched_user);

alter table team_commits enable row level security;
drop policy if exists tcm_read on team_commits;
create policy tcm_read on team_commits for select to authenticated using (team_can_read(team_id));

-- ---- a repó beállítása -----------------------------------------------------
create or replace function public.team_repo_set(p_team uuid, p_url text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u text;
begin
  if not team_can_write(p_team) then raise exception 'Csak a csapat tagjai (és az oktató) állíthatják be'; end if;
  u := btrim(coalesce(p_url, ''));
  if u = '' then
    update course_teams set repo_url = null, repo_synced_at = null where id = p_team;
    delete from team_commits where team_id = p_team;
    return jsonb_build_object('repo_url', null);
  end if;
  -- csak github.com/tulajdonos/repo alak; a .git végződést és a záró perjelet levágjuk
  u := regexp_replace(u, '\.git$', '');
  u := regexp_replace(u, '/+$', '');
  if u !~* '^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$' then
    raise exception 'Így add meg: https://github.com/felhasznalo/repo';
  end if;
  update course_teams set repo_url = u, repo_synced_at = null where id = p_team;
  delete from team_commits where team_id = p_team;   -- másik repó → tiszta lap
  return jsonb_build_object('repo_url', u);
end; $$;

-- ---- a saját GitHub-felhasználónév ----------------------------------------
create or replace function public.team_github_login(p_team uuid, p_login text, p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare target uuid; cid uuid; login text;
begin
  select course_id into cid from course_teams where id = p_team;
  target := coalesce(p_user, auth.uid());
  if target <> auth.uid() and not course_is_instructor(cid) then
    raise exception 'Csak a sajátodat állíthatod be.';
  end if;
  if not team_can_write(p_team) then raise exception 'Nincs jogosultság'; end if;
  login := nullif(btrim(coalesce(p_login, '')), '');
  if login is not null and login !~ '^[A-Za-z0-9-]{1,39}$' then
    raise exception 'A GitHub-felhasználónév betű, szám és kötőjel lehet.';
  end if;
  update course_team_members set github_login = login where team_id = p_team and user_id = target;
  if not found then raise exception 'Ez a hallgató nem tagja a csapatnak.'; end if;
  -- a korábbi commitok is kapjanak gazdát (vagy veszítsék el, ha töröltük a nevet)
  update team_commits set matched_user = case when login is null then null else target end
   where team_id = p_team and lower(coalesce(author_login, '')) = lower(coalesce(login, '\x00'));
  if login is null then
    update team_commits set matched_user = null where team_id = p_team and matched_user = target;
  end if;
  return jsonb_build_object('login', login);
end; $$;

-- ---- commitok beírása (a kliens hozza a GitHubról) -------------------------
-- p_commits: [{"sha":"…","login":"…","name":"…","message":"…","url":"…","at":"2026-09-20T10:00:00Z"}, …]
create or replace function public.team_commits_upsert(p_team uuid, p_commits jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cid uuid; c jsonb; n int := 0; matched uuid;
begin
  if not team_can_write(p_team) then raise exception 'Nincs jogosultság'; end if;
  if jsonb_typeof(p_commits) <> 'array' then raise exception 'Hibás formátum'; end if;
  select course_id into cid from course_teams where id = p_team;
  for c in select * from jsonb_array_elements(p_commits) loop
    if coalesce(c->>'sha', '') = '' then continue; end if;
    select m.user_id into matched from course_team_members m
     where m.team_id = p_team and lower(coalesce(m.github_login, '')) = lower(coalesce(c->>'login', '\x00'));
    insert into team_commits (team_id, course_id, sha, author_login, author_name, message, url, committed_at, matched_user)
    values (p_team, cid, left(c->>'sha', 64), nullif(c->>'login', ''), nullif(c->>'name', ''),
            left(coalesce(c->>'message', ''), 500), nullif(c->>'url', ''),
            nullif(c->>'at', '')::timestamptz, matched)
    on conflict (team_id, sha) do update
      set matched_user = excluded.matched_user, message = excluded.message, committed_at = excluded.committed_at;
    n := n + 1;
  end loop;
  update course_teams set repo_synced_at = now() where id = p_team;
  return jsonb_build_object('received', n,
    'total', (select count(*) from team_commits where team_id = p_team));
end; $$;

-- ---- a repó állapota egy hívásban ------------------------------------------
create or replace function public.team_repo_state(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not team_can_read(p_team) then raise exception 'Nincs hozzáférésed'; end if;
  select * into t from course_teams where id = p_team;
  return jsonb_build_object(
    'repo_url', t.repo_url,
    'synced_at', t.repo_synced_at,
    'can_write', team_can_write(p_team),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'name', p.name, 'role', m.role, 'github_login', m.github_login,
        'commits', (select count(*) from team_commits c where c.team_id = p_team and c.matched_user = m.user_id),
        'last_commit', (select max(c.committed_at) from team_commits c where c.team_id = p_team and c.matched_user = m.user_id))
        order by p.name)
        from course_team_members m join profiles p on p.id = m.user_id
       where m.team_id = p_team), '[]'::jsonb),
    'unmatched', coalesce((select jsonb_agg(jsonb_build_object('login', x.author_login, 'commits', x.n) order by x.n desc)
        from (select author_login, count(*) as n from team_commits
               where team_id = p_team and matched_user is null group by author_login) x), '[]'::jsonb),
    'commits', coalesce((select jsonb_agg(jsonb_build_object(
        'sha', c.sha, 'login', c.author_login, 'name', c.author_name, 'message', c.message,
        'url', c.url, 'at', c.committed_at, 'user', c.matched_user, 'user_name', p.name)
        order by c.committed_at desc)
        from (select * from team_commits where team_id = p_team order by committed_at desc limit 60) c
        left join profiles p on p.id = c.matched_user), '[]'::jsonb),
    'total', (select count(*) from team_commits where team_id = p_team),
    'week', (select count(*) from team_commits where team_id = p_team and committed_at > now() - interval '7 days'));
end; $$;

-- ---- oktatói áttekintés: repó és commit-szám a csapat-kártyákon ------------
create or replace function public.course_repos_overview(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'team_id', t.id, 'name', t.name, 'repo_url', t.repo_url, 'synced_at', t.repo_synced_at,
      'commits', (select count(*) from team_commits c where c.team_id = t.id),
      'week', (select count(*) from team_commits c where c.team_id = t.id and c.committed_at > now() - interval '7 days'),
      'last_commit', (select max(c.committed_at) from team_commits c where c.team_id = t.id),
      'committers', (select count(distinct coalesce(c.matched_user::text, c.author_login)) from team_commits c where c.team_id = t.id),
      'unlinked', (select count(*) from course_team_members m where m.team_id = t.id and m.github_login is null))
      order by t.name)
      from course_teams t where t.course_id = p_course), '[]'::jsonb);
end; $$;

revoke all on function public.team_repo_set(uuid, text)                  from public, anon;
revoke all on function public.team_github_login(uuid, text, uuid)        from public, anon;
revoke all on function public.team_commits_upsert(uuid, jsonb)           from public, anon;
revoke all on function public.team_repo_state(uuid)                      from public, anon;
revoke all on function public.course_repos_overview(uuid)                from public, anon;
grant execute on function public.team_repo_set(uuid, text), public.team_github_login(uuid, text, uuid),
  public.team_commits_upsert(uuid, jsonb), public.team_repo_state(uuid), public.course_repos_overview(uuid)
to authenticated;
