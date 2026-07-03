-- ============================================================================
--  Publify — migration 42: "Érkeztető" (scientific publication intake) — Phase 1.
--  Single editorial office, fixed workflow: draft → submitted → screening → under_review →
--  decision_pending → revision_requested → accepted → camera_ready → published | rejected | withdrawn.
--  Immutable version sets per round; append-only audit trail; single-blind (reviewer identity never
--  exposed to authors). Sized for tens of submissions/year. Idempotent.
-- ============================================================================
set check_function_bodies = off;   -- sub_can_read references submission_reviews created later in this script

-- ---- editorial office membership + helper --------------------------------------------------------
create table if not exists editorial_staff (
  user_id    uuid primary key references profiles(id) on delete cascade,
  staff_role text not null default 'editor',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table editorial_staff enable row level security;
drop policy if exists es_read on editorial_staff;
create policy es_read on editorial_staff for select to authenticated using (true);
drop policy if exists es_write on editorial_staff;
create policy es_write on editorial_staff for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.editorial_staff e where e.user_id = auth.uid() and e.active);
$$;

-- ---- submissions core ----------------------------------------------------------------------------
create sequence if not exists submission_code_seq;
create table if not exists submissions (
  id                 uuid primary key default gen_random_uuid(),
  manuscript_code    text unique,
  owner_id           uuid not null references profiles(id) on delete cascade,   -- corresponding author
  title              text not null,
  abstract           text,
  keywords           text[],
  article_type       text not null default 'article',
  journal_ref_id     bigint references journals_ref(id) on delete set null,
  venue_text         text,
  status             text not null default 'draft',
  round              int  not null default 0,
  handling_editor_id uuid references profiles(id) on delete set null,
  editor_project_id  text,                       -- linked LaTeX editor project (source / camera-ready)
  declarations       jsonb not null default '{}'::jsonb,
  cover_letter       text,
  submitted_at       timestamptz,
  decided_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists sub_owner_idx  on submissions(owner_id);
create index if not exists sub_status_idx on submissions(status);

create or replace function public.sub_assign_code() returns trigger language plpgsql as $$
begin
  if new.manuscript_code is null then
    new.manuscript_code := 'NJE-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('submission_code_seq')::text, 3, '0');
  end if;
  return new;
end; $$;
drop trigger if exists sub_code_trg on submissions;
create trigger sub_code_trg before insert on submissions for each row execute function public.sub_assign_code();

create or replace function public.sub_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists sub_touch_trg on submissions;
create trigger sub_touch_trg before update on submissions for each row execute function public.sub_touch();

-- reader helper: owner, editorial office, admin, or an assigned (non-declined) reviewer
create or replace function public.sub_can_read(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.submissions s where s.id = sid and (s.owner_id = auth.uid()))
      or public.is_editor() or public.is_admin()
      or exists (select 1 from public.submission_reviews r where r.submission_id = sid
                 and r.reviewer_id = auth.uid() and r.status in ('invited','agreed','completed'));
$$;

alter table submissions enable row level security;
drop policy if exists sub_select on submissions;
create policy sub_select on submissions for select to authenticated using (public.sub_can_read(id));
drop policy if exists sub_insert on submissions;
create policy sub_insert on submissions for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists sub_update on submissions;
create policy sub_update on submissions for update to authenticated
  using (public.is_editor() or public.is_admin() or (owner_id = auth.uid() and status not in ('rejected','published','withdrawn')))
  with check (public.is_editor() or public.is_admin() or owner_id = auth.uid());
drop policy if exists sub_delete on submissions;
create policy sub_delete on submissions for delete to authenticated
  using (public.is_admin() or (owner_id = auth.uid() and status = 'draft'));

-- ---- ordered author list -------------------------------------------------------------------------
create table if not exists submission_authors (
  id               uuid primary key default gen_random_uuid(),
  submission_id    uuid not null references submissions(id) on delete cascade,
  position         int  not null default 1,
  name             text not null,
  email            text,
  affiliation      text,
  orcid            text,
  user_id          uuid references profiles(id) on delete set null,
  is_corresponding boolean not null default false
);
create index if not exists suba_sub_idx on submission_authors(submission_id);
alter table submission_authors enable row level security;
drop policy if exists suba_select on submission_authors;
create policy suba_select on submission_authors for select to authenticated using (public.sub_can_read(submission_id));
drop policy if exists suba_write on submission_authors;
create policy suba_write on submission_authors for all to authenticated
  using (public.is_editor() or public.is_admin() or exists (select 1 from submissions s where s.id = submission_id and s.owner_id = auth.uid()))
  with check (public.is_editor() or public.is_admin() or exists (select 1 from submissions s where s.id = submission_id and s.owner_id = auth.uid()));

-- ---- immutable per-round version sets (NO update/delete policies — append only) --------------------
create table if not exists submission_versions (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  round         int  not null default 0,
  kind          text not null default 'manuscript',  -- manuscript|title_page|response_to_reviewers|supplement|camera_ready
  storage_path  text,
  file_name     text,
  size          bigint,
  uploaded_by   uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists subv_sub_idx on submission_versions(submission_id, round);
alter table submission_versions enable row level security;
drop policy if exists subv_select on submission_versions;
create policy subv_select on submission_versions for select to authenticated using (public.sub_can_read(submission_id));
drop policy if exists subv_insert on submission_versions;
create policy subv_insert on submission_versions for insert to authenticated
  with check (public.is_editor() or public.is_admin() or exists (select 1 from submissions s where s.id = submission_id and s.owner_id = auth.uid()));

-- ---- reviewer assignment + review (single-blind: NEVER selectable by the author) -------------------
create table if not exists submission_reviews (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references submissions(id) on delete cascade,
  round           int  not null default 1,
  reviewer_id     uuid not null references profiles(id) on delete cascade,
  status          text not null default 'invited',   -- invited|agreed|declined|completed|cancelled
  due_at          timestamptz,
  coi_declared    boolean not null default false,
  recommendation  text,                              -- accept|minor|major|reject
  comments_author text,
  comments_editor text,
  invited_by      uuid references profiles(id) on delete set null,
  submitted_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique (submission_id, round, reviewer_id)
);
create index if not exists subr_sub_idx on submission_reviews(submission_id, round);
create index if not exists subr_rev_idx on submission_reviews(reviewer_id);
alter table submission_reviews enable row level security;
drop policy if exists subr_select on submission_reviews;
create policy subr_select on submission_reviews for select to authenticated
  using (public.is_editor() or public.is_admin() or reviewer_id = auth.uid());
drop policy if exists subr_insert on submission_reviews;
create policy subr_insert on submission_reviews for insert to authenticated with check (public.is_editor() or public.is_admin());
drop policy if exists subr_update on submission_reviews;
create policy subr_update on submission_reviews for update to authenticated
  using (public.is_editor() or public.is_admin() or reviewer_id = auth.uid())
  with check (public.is_editor() or public.is_admin() or reviewer_id = auth.uid());

-- ---- append-only audit trail ------------------------------------------------------------------------
create table if not exists submission_events (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  actor_id      uuid references profiles(id) on delete set null,
  event         text not null,
  from_status   text,
  to_status     text,
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists sube_sub_idx on submission_events(submission_id, created_at);
alter table submission_events enable row level security;
drop policy if exists sube_select on submission_events;
create policy sube_select on submission_events for select to authenticated
  using (public.is_editor() or public.is_admin() or exists (select 1 from submissions s where s.id = submission_id and s.owner_id = auth.uid()));
drop policy if exists sube_insert on submission_events;
create policy sube_insert on submission_events for insert to authenticated
  with check (public.is_editor() or public.is_admin() or exists (select 1 from submissions s where s.id = submission_id and s.owner_id = auth.uid()));

-- ---- letters actually sent + editable templates -----------------------------------------------------
create table if not exists submission_letters (
  id                uuid primary key default gen_random_uuid(),
  submission_id     uuid not null references submissions(id) on delete cascade,
  template_key      text,
  subject           text,
  body              text,
  recipient_user_id uuid references profiles(id) on delete set null,
  sent_by           uuid references profiles(id) on delete set null,
  sent_at           timestamptz not null default now()
);
create index if not exists subl_sub_idx on submission_letters(submission_id);
alter table submission_letters enable row level security;
drop policy if exists subl_select on submission_letters;
create policy subl_select on submission_letters for select to authenticated
  using (public.is_editor() or public.is_admin() or exists (select 1 from submissions s where s.id = submission_id and s.owner_id = auth.uid()));
drop policy if exists subl_insert on submission_letters;
create policy subl_insert on submission_letters for insert to authenticated with check (public.is_editor() or public.is_admin());

create table if not exists letter_templates (
  key        text primary key,
  stage      text,
  subject    text not null,
  body       text not null,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table letter_templates enable row level security;
drop policy if exists lt_select on letter_templates;
create policy lt_select on letter_templates for select to authenticated using (true);
drop policy if exists lt_write on letter_templates;
create policy lt_write on letter_templates for all to authenticated
  using (public.is_editor() or public.is_admin()) with check (public.is_editor() or public.is_admin());

-- ---- private storage bucket ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('submission-files','submission-files', false)
on conflict (id) do nothing;
drop policy if exists subfiles_read on storage.objects;
create policy subfiles_read on storage.objects for select to authenticated
  using (bucket_id = 'submission-files' and public.sub_can_read(((storage.foldername(name))[1])::uuid));
drop policy if exists subfiles_insert on storage.objects;
create policy subfiles_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'submission-files' and (public.is_editor() or public.is_admin()
    or exists (select 1 from submissions s where s.id = ((storage.foldername(name))[1])::uuid and s.owner_id = auth.uid())));

-- ---- seed letter templates ------------------------------------------------------------------------------
insert into letter_templates (key, stage, subject, body) values
 ('ack_received','intake','[{manuscriptId}] Submission received','Dear {authorName},

Thank you for submitting "{title}" to the editorial office. Your manuscript has been registered under the ID {manuscriptId} and will now undergo an initial editorial check. We will contact you with the outcome.

Kind regards,
Editorial Office'),
 ('desk_reject','intake','[{manuscriptId}] Editorial decision','Dear {authorName},

Thank you for submitting "{title}". After initial editorial assessment we regret to inform you that the manuscript cannot be considered further, for the following reason(s):

{reason}

We wish you success in publishing your work elsewhere.

Kind regards,
Editorial Office'),
 ('return_corrections','intake','[{manuscriptId}] Corrections required before review','Dear {authorName},

Thank you for submitting "{title}". Before we can send the manuscript to review, the following must be corrected:

{reason}

Please update your submission and resubmit.

Kind regards,
Editorial Office'),
 ('decision_accept','decision','[{manuscriptId}] Decision: Accept','Dear {authorName},

We are pleased to inform you that your manuscript "{title}" has been accepted. Please prepare the camera-ready version.

Reviewer comments:
{reviews}

Kind regards,
Editorial Office'),
 ('decision_minor','decision','[{manuscriptId}] Decision: Minor revision','Dear {authorName},

Your manuscript "{title}" requires a MINOR revision. Please address the comments below and upload a revised version together with a response letter by {dueDate}.

Reviewer comments:
{reviews}

Kind regards,
Editorial Office'),
 ('decision_major','decision','[{manuscriptId}] Decision: Major revision','Dear {authorName},

Your manuscript "{title}" requires a MAJOR revision. Please address the comments below and upload a revised version together with a point-by-point response letter by {dueDate}.

Reviewer comments:
{reviews}

Kind regards,
Editorial Office'),
 ('decision_reject','decision','[{manuscriptId}] Decision: Reject','Dear {authorName},

We regret to inform you that your manuscript "{title}" cannot be accepted for publication.

Reviewer comments:
{reviews}

We thank you for considering our venue.

Kind regards,
Editorial Office')
on conflict (key) do nothing;

-- Phase 2 addendum: editor-visible reviewer display name (profiles are privacy-locked; captured at invite time from pr_search_users)
alter table submission_reviews add column if not exists reviewer_name text;
