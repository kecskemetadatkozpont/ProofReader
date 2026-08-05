-- migration-109-review-requests.sql
-- Admin-approval workflow for Elicit review runs. A user launching an Elicit systematic review files a REQUEST
-- that an admin must approve; only on approval does the (paid) Elicit run start (server-side, in elicit-proxy
-- sr.approve). The OpenAlex funnel (built-in, PRStudyRunner) needs no approval — it never touches this table.
--
-- Design: a SEPARATE table (not an elicit_jobs.status overload — that would wedge elicit_jobs_pending_uniq + cron).
-- status: pending_approval → approved | rejected | cancelled.  job_id set when approval spawns the Elicit run;
-- approved WITH job_id = null means Elicit failed after approval → the requester's client runs the OpenAlex fallback.
--
-- Prereq: migration-34 (research_projects), 49 (is_admin/is_feature_enabled), 51 (elicit_jobs), 55 (sr_candidates),
--         88 (elicit_jobs project RLS), 31 (nf_insert). Apply MANUALLY in the Supabase SQL editor. Idempotent.
create table if not exists public.research_review_requests (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid references public.research_projects(id) on delete cascade,     -- nullable, mirrors elicit_jobs
  candidate_id      uuid references public.research_sr_candidates(id) on delete set null,
  requested_by      uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  kind              text not null default 'sysreview',
  research_question text,
  params            jsonb not null default '{}'::jsonb,        -- the FULL srBody so approval replays the exact run
  q_hash            text,
  status            text not null default 'pending_approval'
                      check (status in ('pending_approval','approved','rejected','cancelled')),
  decided_by        uuid references public.profiles(id) on delete set null,
  decided_at        timestamptz,
  decision_note     text,
  job_id            uuid references public.elicit_jobs(id) on delete set null,   -- Elicit job when the approved run ignited
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists rrr_project_idx on public.research_review_requests(project_id, created_at desc);
create index if not exists rrr_pending_idx on public.research_review_requests(created_at) where status = 'pending_approval';
-- one OPEN request per (user,kind,question); terminal states excluded so reject/cancel never wedge re-request
create unique index if not exists rrr_pending_uniq on public.research_review_requests(requested_by, kind, q_hash)
  where status = 'pending_approval';

alter table public.research_review_requests enable row level security;
-- READ: your own, an admin, or any reader of the linked project (mirrors migration-88 elicit_jobs_read)
drop policy if exists rrr_read on public.research_review_requests;
create policy rrr_read on public.research_review_requests for select to authenticated
  using (requested_by = auth.uid() or public.is_admin()
         or (project_id is not null and public.research_can_read_project(project_id)));
-- INSERT: only your OWN request, on a project you can write, only if entitled (defense-in-depth; edge fn also checks)
drop policy if exists rrr_insert on public.research_review_requests;
create policy rrr_insert on public.research_review_requests for insert to authenticated
  with check (requested_by = auth.uid()
              and (project_id is null or public.research_can_write_project(project_id))
              and public.is_feature_enabled('elicit_sysreview'));
-- ADMIN: full management for the console. NO non-admin UPDATE/DELETE → decisions flow only through the RPC / edge fn.
drop policy if exists rrr_admin on public.research_review_requests;
create policy rrr_admin on public.research_review_requests for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert on table public.research_review_requests to authenticated;

-- reject (admin) / cancel (requester). Approval is intentionally NOT here — it must POST to Elicit from the edge fn.
create or replace function public.review_request_decide(req_id uuid, approve boolean, note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.research_review_requests;
begin
  select * into r from public.research_review_requests where id = req_id;
  if r.id is null then raise exception 'request not found'; end if;
  if approve then raise exception 'approval must run through elicit-proxy sr.approve'; end if;
  if not (public.is_admin() or r.requested_by = auth.uid()) then raise exception 'not authorized'; end if;
  if r.status <> 'pending_approval' then return; end if;   -- idempotent (already decided)
  update public.research_review_requests
     set status = case when public.is_admin() then 'rejected' else 'cancelled' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = note, updated_at = now()
   where id = req_id and status = 'pending_approval';
  insert into public.notifications (recipient_id, kind, payload)
  values (r.requested_by, 'sr_review',
          jsonb_build_object('type','sr_decision','decision','rejected','request_id',req_id,
                             'title', coalesce(r.research_question,'Elicit review'),
                             'project_id', r.project_id,
                             'href','Research.html?project='||coalesce(r.project_id::text,'')));
end; $$;
revoke all on function public.review_request_decide(uuid,boolean,text) from public, anon;
grant execute on function public.review_request_decide(uuid,boolean,text) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='research_review_requests') then
    alter publication supabase_realtime add table public.research_review_requests;
  end if;
end $$;

-- verify:
--   select count(*) from public.research_review_requests;
--   select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='research_review_requests';
