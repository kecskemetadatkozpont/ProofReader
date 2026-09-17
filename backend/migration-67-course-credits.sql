-- ============================================================================
--  Publify — migration 67: course credit budgets + MCP audit log + media bucket.
--
--  Pattern: migration-48 (ai_usage) — but with PER-SERVICE, ATOMIC debit taken
--  BEFORE the provider call by the mcp-bridge edge fn. Builds on migration-66
--  (courses, course_is_member/instructor helpers).
--
--  SAFE-BY-DEFAULT (hardened per the security review):
--   - course_credit_debit: row-locked check-and-charge under the STUDENT's JWT;
--     false = no budget left (bridge answers 429 + denied_quota log).
--   - course_credit_refund takes an explicit p_user and is SERVICE-ROLE ONLY
--     (an authenticated grant + auth.uid() would have let any student zero out
--     their own `used` counter from the browser console).
--   - mcp_call_log has NO insert/update/delete policy → only the service client
--     writes it (edge fn) — students cannot forge or erase provenance.
--
--  Apply in the Supabase SQL editor. Idempotent — safe to re-run.
-- ============================================================================

-- ---- 1. per-service credit budgets ------------------------------------------

create table if not exists course_credit_budgets (
  course_id  uuid not null references courses(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  service    text not null,                 -- 'llm' | 'image' | 'video' | 'audio' | 'search'
  granted    numeric not null default 0,    -- credits allotted for the semester
  used       numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (course_id, user_id, service)
);

alter table course_credit_budgets enable row level security;

drop policy if exists ccb_read on course_credit_budgets;
create policy ccb_read on course_credit_budgets for select to authenticated
  using (user_id = auth.uid() or course_is_instructor(course_id));   -- "how much is left" bar
drop policy if exists ccb_write on course_credit_budgets;
create policy ccb_write on course_credit_budgets for all to authenticated
  using (course_is_instructor(course_id)) with check (course_is_instructor(course_id));

-- ---- 2. atomic debit / service-role refund ----------------------------------

-- ATOMIC debit: checks and charges under a row lock; false = insufficient funds.
-- Called by the mcp-bridge with the STUDENT's JWT (SECURITY DEFINER, auth.uid() = student).
create or replace function public.course_credit_debit(p_course uuid, p_service text, p_amount numeric)
returns boolean language plpgsql security definer set search_path = public as $$
declare ok boolean := false;
begin
  update course_credit_budgets
     set used = used + p_amount, updated_at = now()
   where course_id = p_course and user_id = auth.uid() and service = p_service
     and used + p_amount <= granted
  returning true into ok;
  return coalesce(ok, false);
end; $$;

-- Refund on failed/aborted generation — callable EXCLUSIVELY by the service role!
-- (security-review fix: explicit p_user + revoke from authenticated/public; the
--  bridge refunds with the service client, same as the mcp_call_log INSERT).
create or replace function public.course_credit_refund(p_course uuid, p_user uuid, p_service text, p_amount numeric)
returns void language sql security definer set search_path = public as $$
  update course_credit_budgets set used = greatest(0, used - p_amount), updated_at = now()
  where course_id = p_course and user_id = p_user and service = p_service;
$$;

revoke all on function public.course_credit_debit(uuid,text,numeric)         from public, anon;
grant execute on function public.course_credit_debit(uuid,text,numeric)      to authenticated;
revoke all on function public.course_credit_refund(uuid,uuid,text,numeric)   from public, anon, authenticated;
grant execute on function public.course_credit_refund(uuid,uuid,text,numeric) to service_role;

-- ---- 3. audited MCP tool calls (service client writes — unforgeable) ---------

create table if not exists mcp_call_log (
  id            bigint generated always as identity primary key,
  course_id     uuid references courses(id) on delete set null,
  assignment_id uuid references lab_assignments(id) on delete set null,
  user_id       uuid not null references profiles(id) on delete cascade,
  provider      text not null,        -- anthropic-mcp | gemini | elevenlabs | higgsfield
  server        text,                 -- 'higgsfield' | 'consensus' | 'github' | ...
  tool          text,                 -- 'generate_image' | 'search' | null (plain LLM turn)
  model         text,
  prompt        text,                 -- FULL user prompt (provenance!)
  params        jsonb,                -- tool input / generation parameters
  response_meta jsonb,                -- {tokens_in,tokens_out,duration_ms,media_paths:[...]}
  credits       numeric not null default 0,
  status        text not null default 'ok',   -- ok | error | denied_quota | denied_tool
  created_at    timestamptz not null default now()
);
create index if not exists mcl_course_idx on mcp_call_log(course_id, created_at desc);
create index if not exists mcl_user_idx   on mcp_call_log(user_id, created_at desc);

alter table mcp_call_log enable row level security;

drop policy if exists mcl_read on mcp_call_log;
create policy mcl_read on mcp_call_log for select to authenticated
  using (user_id = auth.uid() or course_is_instructor(course_id));
-- NO insert/update/delete policy → only the service role writes (from the edge fn);
-- denied_* attempts are logged too — a blocked call is also an audit event.

-- ---- 4. storage: course media bucket -----------------------------------------
--  Path contract: '<course_id>/<user_id>/...' — first segment = course, second
--  segment = the uploader (review fix: cm_write enforces it, so one student
--  cannot plant files under another's folder — the canvas/submission provenance
--  triggers in migration-66/68 validate against this same prefix). The uuid
--  cast is regex-guarded in EVERY policy (a non-uuid first segment must yield
--  false, not a cast error). The mcp-bridge uploads with the service client
--  (bypasses these policies).

insert into storage.buckets (id, name, public) values ('course-media','course-media', false)
  on conflict (id) do nothing;

drop policy if exists cm_read on storage.objects;
create policy cm_read on storage.objects for select to authenticated
  using (bucket_id = 'course-media'
    and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then course_is_member(((storage.foldername(name))[1])::uuid)
             else false end);
drop policy if exists cm_write on storage.objects;
create policy cm_write on storage.objects for insert to authenticated
  with check (bucket_id = 'course-media'
    and (storage.foldername(name))[2] = auth.uid()::text
    and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then course_is_member(((storage.foldername(name))[1])::uuid)
             else false end);
drop policy if exists cm_delete on storage.objects;
create policy cm_delete on storage.objects for delete to authenticated
  using (bucket_id = 'course-media'
    and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then course_is_instructor(((storage.foldername(name))[1])::uuid)
             else false end);
-- review fix: the uploader may delete their OWN objects (under '<course>/<uid>/')
-- — e.g. withdrawing a bad upload — without needing the instructor.
drop policy if exists cm_delete_own on storage.objects;
create policy cm_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'course-media'
    and (storage.foldername(name))[2] = auth.uid()::text
    and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then course_is_member(((storage.foldername(name))[1])::uuid)
             else false end);

-- ---------------------------------------------------------------------------
-- Verify after apply:
--   select public.course_credit_debit('00000000-0000-0000-0000-000000000000','llm',1); -- false
--   select count(*) from mcp_call_log;                                                 -- 0
--   select id from storage.buckets where id = 'course-media';                          -- 1 row
-- ---------------------------------------------------------------------------
