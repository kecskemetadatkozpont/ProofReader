-- ============================================================================
--  Publify — migration 68: class canvas + polls (peer voting).
--
--  The shared course canvas: every generated artifact (image/video/audio/text)
--  is posted WITH its full provenance (prompt + model + params + mcp_call_log
--  link). Realtime pattern: migration-62. Builds on migration-66 (courses,
--  course_is_member/instructor) and migration-67 (mcp_call_log, course-media).
--
--  The migration-31/32/33 isolation is NOT relaxed: visibility opens ONLY on
--  the course_canvas_* tables, ONLY along a shared course_enrollment. No
--  profile PII crosses — author display goes through the canvas_author() RPC
--  (anonymity-aware) / the existing profiles_public view.
--
--  POLLS (new requirement): students vote on each other's canvas items (e.g.
--  prompt championship, week-12 awards). Rules enforced server-side in
--  cast_vote(): course member only, open poll only, NEVER on your own item,
--  at most max_votes_per_voter per poll; votes retractable; voters anonymous
--  to peers (aggregate via poll_results()), instructor sees the voter list.
--
--  Apply in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

-- ---- 1. canvas items ---------------------------------------------------------

create table if not exists course_canvas_items (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses(id) on delete cascade,
  lecture_id  uuid references course_lectures(id) on delete set null,  -- per-lecture "page" (frame)
  author_id   uuid not null default auth.uid() references profiles(id) on delete cascade,
  kind        text not null default 'image',   -- image | video | audio | text | link | app
  media_path  text,                            -- course-media bucket
  media_url   text,                            -- external URL (e.g. Veo/Higgsfield CDN, deployed app)
  thumb_path  text,
  title       text,
  -- ---- PROVENANCE (client requirement: FULL prompt + model + parameters) ----
  prompt      text not null,
  neg_prompt  text,
  model       text not null,                   -- e.g. 'imagen-4', 'claude-sonnet-5', 'higgsfield/...'
  provider    text not null,
  params      jsonb not null default '{}'::jsonb,
  call_log_id bigint references mcp_call_log(id) on delete set null,  -- hard provenance chain
  -- ---- layout + moderation + GDPR ----
  x numeric not null default 0, y numeric not null default 0,
  w numeric not null default 320, h numeric not null default 240,
  anon      boolean not null default false,    -- hide author from peers (GDPR opt-out)
  hidden    boolean not null default false,    -- instructor moderation (hide, not delete)
  pinned    boolean not null default false,    -- instructor highlight (week-12 vernissage)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cci_course_idx on course_canvas_items(course_id, lecture_id);
create index if not exists cci_author_idx on course_canvas_items(author_id);

create table if not exists course_canvas_reactions (
  item_id    uuid not null references course_canvas_items(id) on delete cascade,
  user_id    uuid not null default auth.uid() references profiles(id) on delete cascade,
  emoji      text not null default '❤️',
  created_at timestamptz not null default now(),
  primary key (item_id, user_id, emoji)
);

-- ---- 2. RLS ------------------------------------------------------------------

alter table course_canvas_items     enable row level security;
alter table course_canvas_reactions enable row level security;

-- read: course member; a hidden item is seen only by its author + the instructor
-- ANON MODE — residual risk (documented, review item): the author_id column is
-- readable by every course member through cci_read (the client needs it for
-- is_mine/drag-gating), so the 'anon' flag is DISPLAY anonymity only — a
-- technical user can resolve author_id via profiles_public despite canvas_author()
-- hiding the name. Full fix (security_invoker view that nulls author_id for
-- anon rows + realtime payload filtering) is a P1 item.
drop policy if exists cci_read on course_canvas_items;
create policy cci_read on course_canvas_items for select to authenticated
  using (course_is_member(course_id)
         and (not hidden or author_id = auth.uid() or course_is_instructor(course_id)));
-- write: the author their own item (post + move), the instructor anything (moderation)
drop policy if exists cci_insert on course_canvas_items;
create policy cci_insert on course_canvas_items for insert to authenticated
  with check (author_id = auth.uid() and course_is_member(course_id));
drop policy if exists cci_update on course_canvas_items;
create policy cci_update on course_canvas_items for update to authenticated
  using  (author_id = auth.uid() or course_is_instructor(course_id))
  with check (author_id = auth.uid() or course_is_instructor(course_id));
drop policy if exists cci_delete on course_canvas_items;
create policy cci_delete on course_canvas_items for delete to authenticated
  using (author_id = auth.uid() or course_is_instructor(course_id));

-- Only the instructor may flip hidden/pinned, and the provenance fields are
-- immutable after posting (security-review fix) → BEFORE trigger
-- (guard_profile_update pattern, migration-49).
create or replace function public.guard_canvas_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if course_is_instructor(old.course_id) then return new; end if;
  -- a student's legitimate update is layout/display ONLY: x/y/w/h/title/anon —
  -- everything else is frozen after posting (review fix: media/kind/scope too).
  new.hidden := old.hidden; new.pinned := old.pinned;                  -- students don't moderate
  new.author_id := old.author_id; new.call_log_id := old.call_log_id;  -- provenance not rewritable
  new.prompt := old.prompt; new.neg_prompt := old.neg_prompt;          -- the prompt is immutable
  new.model := old.model; new.provider := old.provider;                -- after posting
  new.params := old.params;
  new.media_path := old.media_path; new.media_url := old.media_url;    -- media not swappable
  new.thumb_path := old.thumb_path; new.kind := old.kind;
  new.course_id := old.course_id; new.lecture_id := old.lecture_id;    -- no cross-course/lecture move
  new.created_at := old.created_at;
  return new;
end; $$;
drop trigger if exists guard_canvas_update_trg on course_canvas_items;
create trigger guard_canvas_update_trg before update on course_canvas_items
  for each row execute function public.guard_canvas_update();

-- Provenance-forgery guard (review fix): a student may only attach THEIR OWN,
-- same-course mcp_call_log row, and may only point media_path into their own
-- '<course_id>/<auth.uid()>/' folder. Instructor (and the service client,
-- auth.uid() is null there) bypasses — SECURITY DEFINER so the mcp_call_log
-- lookup works despite the table having no student-visible write policies.
create or replace function public.guard_canvas_provenance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or course_is_instructor(new.course_id) then return new; end if;
  if new.call_log_id is not null and not exists (
       select 1 from mcp_call_log l
        where l.id = new.call_log_id
          and l.user_id = auth.uid()
          and l.course_id = new.course_id) then
    raise exception 'A call_log_id csak saját, ehhez a kurzushoz tartozó hívás lehet.';
  end if;
  if new.media_path is not null
     and new.media_path not like (new.course_id::text || '/' || auth.uid()::text || '/%') then
    raise exception 'A media_path csak a saját kurzus-mappádra mutathat.';
  end if;
  return new;
end; $$;
drop trigger if exists guard_canvas_provenance_trg on course_canvas_items;
create trigger guard_canvas_provenance_trg before insert or update on course_canvas_items
  for each row execute function public.guard_canvas_provenance();

drop policy if exists ccr_read on course_canvas_reactions;
create policy ccr_read on course_canvas_reactions for select to authenticated
  using (exists (select 1 from course_canvas_items i where i.id = item_id and course_is_member(i.course_id)));
drop policy if exists ccr_write on course_canvas_reactions;
create policy ccr_write on course_canvas_reactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid()
    and exists (select 1 from course_canvas_items i where i.id = item_id and course_is_member(i.course_id)));

-- ---- 3. anonymous mode: author display via definer RPC ------------------------
--  The client never decides the author's name — the RPC hides it when anon.

create or replace function public.canvas_author(item uuid)
returns table (display_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select case when i.anon and i.author_id <> auth.uid() and not course_is_instructor(i.course_id)
              then 'Anonim hallgató' else p.name end,
         case when i.anon and i.author_id <> auth.uid() and not course_is_instructor(i.course_id)
              then null else p.avatar_url end
  from course_canvas_items i join profiles p on p.id = i.author_id
  where i.id = item and course_is_member(i.course_id);
$$;
revoke all on function public.canvas_author(uuid) from public, anon;
grant execute on function public.canvas_author(uuid) to authenticated;

-- ---- 4. polls: students vote on each other's work ----------------------------

create table if not exists course_polls (
  id                  uuid primary key default gen_random_uuid(),
  course_id           uuid not null references courses(id) on delete cascade,
  lecture_id          uuid references course_lectures(id) on delete set null,  -- optional lecture scope
  title               text not null,                 -- 'Prompt-bajnokság — 4. hét'
  category            text,                          -- e.g. 'prompt' | 'kep' | 'video' | 'dij'
  max_votes_per_voter int  not null default 3,
  status              text not null default 'open',  -- open | closed
  created_by          uuid not null default auth.uid() references profiles(id) on delete cascade,
  --  ^ CONTRACT: course-ops inserts don't pass a creator — the default fills it
  created_at          timestamptz not null default now(),
  closed_at           timestamptz
);
create index if not exists cp_course_idx on course_polls(course_id, created_at desc);

create table if not exists course_poll_votes (
  poll_id    uuid not null references course_polls(id) on delete cascade,
  item_id    uuid not null references course_canvas_items(id) on delete cascade,
  voter_id   uuid not null default auth.uid() references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, item_id, voter_id)           -- 1 vote / voter / item
);
create index if not exists cpv_poll_idx on course_poll_votes(poll_id, item_id);

alter table course_polls      enable row level security;
alter table course_poll_votes enable row level security;

-- polls: member reads, instructor manages (open/close/create)
drop policy if exists cp_read on course_polls;
create policy cp_read on course_polls for select to authenticated
  using (course_is_member(course_id));
drop policy if exists cp_write on course_polls;
create policy cp_write on course_polls for all to authenticated
  using (course_is_instructor(course_id)) with check (course_is_instructor(course_id));

-- votes: the voter sees + retracts their OWN votes; the instructor sees all
-- (peers never see who voted what → aggregate goes through poll_results()).
drop policy if exists cpv_read on course_poll_votes;
create policy cpv_read on course_poll_votes for select to authenticated
  using (voter_id = auth.uid()
     or exists (select 1 from course_polls p where p.id = poll_id and course_is_instructor(p.course_id)));
-- NO direct INSERT policy (review fix): cast_vote() below is the SINGLE write
-- path — as SECURITY DEFINER it runs as the table owner and steps outside RLS,
-- so no permissive insert policy is needed (a race on the budget count via
-- direct INSERT is thereby impossible). The drop below removes the earlier
-- defense-in-depth policy from already-migrated databases (idempotent).
drop policy if exists cpv_insert on course_poll_votes;
-- NO direct DELETE policy for students either (review fix): retract_vote()
-- below is the single retraction path. Only the SELECT policy remains
-- (own votes + instructor sees all).
drop policy if exists cpv_delete on course_poll_votes;
-- no UPDATE policy — a vote is cast or retracted, never edited

-- ---- 5. poll RPCs (SECURITY DEFINER, the validated narrow path) --------------

--  cast_vote: validates member + open poll + not own item + remaining budget;
--  duplicate vote on the same item → error. Poll row is locked to serialize
--  the budget count per poll.
create or replace function public.cast_vote(p_poll uuid, p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  poll  course_polls%rowtype;
  it    course_canvas_items%rowtype;
  spent int;
begin
  select * into poll from course_polls where id = p_poll for update;
  if poll.id is null then raise exception 'A szavazás nem található'; end if;
  if not course_is_member(poll.course_id) then raise exception 'Csak kurzustag szavazhat'; end if;
  if poll.status <> 'open' then raise exception 'A szavazás már lezárult'; end if;

  select * into it from course_canvas_items where id = p_item;
  if it.id is null or it.course_id <> poll.course_id then
    raise exception 'Az elem nem ehhez a kurzushoz tartozik';
  end if;
  if poll.lecture_id is not null and it.lecture_id is distinct from poll.lecture_id then
    raise exception 'Az elem nem ehhez az előadás-laphoz tartozik.';
  end if;
  if it.hidden then raise exception 'Rejtett elemre nem lehet szavazni'; end if;
  if it.author_id = auth.uid() then raise exception 'Saját munkára nem szavazhatsz'; end if;

  select count(*) into spent from course_poll_votes
   where poll_id = p_poll and voter_id = auth.uid();
  if spent >= poll.max_votes_per_voter then
    raise exception 'Elfogytak a szavazataid (legfeljebb % adható le)', poll.max_votes_per_voter;
  end if;

  insert into course_poll_votes (poll_id, item_id, voter_id)
    values (p_poll, p_item, auth.uid());
exception when unique_violation then
  raise exception 'Erre a munkára már szavaztál';
end; $$;

create or replace function public.retract_vote(p_poll uuid, p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from course_poll_votes
   where poll_id = p_poll and item_id = p_item and voter_id = auth.uid();
  if not found then raise exception 'Nincs visszavonható szavazatod erre az elemre'; end if;
end; $$;

--  poll_results: item_id → vote-count aggregate for EVERY course member
--  (descending → top-3 is the first 3 rows after closing); the voter LIST
--  stays instructor-only (cpv_read policy above).
create or replace function public.poll_results(p_poll uuid)
returns table (item_id uuid, votes bigint)
language sql stable security definer set search_path = public as $$
  select v.item_id, count(*)::bigint
  from course_poll_votes v
  join course_polls p on p.id = v.poll_id
  where v.poll_id = p_poll and course_is_member(p.course_id)
  group by v.item_id
  order by count(*) desc, v.item_id;
$$;

revoke all on function public.cast_vote(uuid,uuid)    from public, anon;
revoke all on function public.retract_vote(uuid,uuid) from public, anon;
revoke all on function public.poll_results(uuid)      from public, anon;
grant execute on function public.cast_vote(uuid,uuid)    to authenticated;
grant execute on function public.retract_vote(uuid,uuid) to authenticated;
grant execute on function public.poll_results(uuid)      to authenticated;

-- ---- 6. Realtime (migration-62 pattern) ---------------------------------------
--  Items/reactions: cards float in live on the projected canvas during the lab.
--  Poll votes: live result count (RLS applies on Realtime too — a student only
--  receives their own vote events, the instructor all of them).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'course_canvas_items') then
    alter publication supabase_realtime add table course_canvas_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'course_canvas_reactions') then
    alter publication supabase_realtime add table course_canvas_reactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'course_poll_votes') then
    alter publication supabase_realtime add table course_poll_votes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'course_polls') then
    alter publication supabase_realtime add table course_polls;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Verify after apply:
--   select count(*) from course_canvas_items;                       -- 0
--   select public.poll_results('00000000-0000-0000-0000-000000000000'); -- 0 rows
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename like 'course_%'; -- 4 rows
-- ---------------------------------------------------------------------------
