


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."ai_over_budget"("max_calls" integer) RETURNS boolean
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select calls from ai_usage where user_id = auth.uid() and day = current_date), 0) >= max_calls;
$$;


ALTER FUNCTION "public"."ai_over_budget"("max_calls" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_usage_bump"() RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  insert into ai_usage (user_id, day, calls) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set calls = ai_usage.calls + 1;
$$;


ALTER FUNCTION "public"."ai_usage_bump"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."build_research_digests"("for_day" "date") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n int := 0;
begin
  insert into notifications (recipient_id, kind, payload)
  select sup.supervisor_id, 'digest',
         jsonb_build_object(
           'day', for_day,
           'entries', count(*),
           'students', count(distinct st.id),
           'projects', count(distinct rp.id),
           'student_names', jsonb_agg(distinct st.name),
           'items', jsonb_agg(jsonb_build_object(
                'student', st.name, 'project', rp.title, 'type', rl.type,
                'summary', rl.summary, 'ts', rl.ts) order by rl.ts)
         )
  from (
    select v.supervisor_id, v.student_id from phd_supervisions v where v.status = 'accepted'
    union
    select s.supervisor_id, s.id from phd_students s where s.supervisor_id is not null
  ) sup
  join phd_students st on st.id = sup.student_id
  join research_projects rp on rp.student_id = st.id
  join research_log rl on rl.project_id = rp.id
  where rl.ts >= for_day::timestamptz
    and rl.ts < (for_day + 1)::timestamptz
    and not exists (
      select 1 from notifications nx
      where nx.recipient_id = sup.supervisor_id and nx.kind = 'digest'
        and (nx.payload->>'day') = for_day::text
    )
  group by sup.supervisor_id;
  get diagnostics n = row_count;
  return n;
end; $$;


ALTER FUNCTION "public"."build_research_digests"("for_day" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."canvas_author"("item" "uuid") RETURNS TABLE("display_name" "text", "avatar_url" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when i.anon and i.author_id <> auth.uid() and not course_is_instructor(i.course_id)
              then 'Anonim hallgató' else p.name end,
         case when i.anon and i.author_id <> auth.uid() and not course_is_instructor(i.course_id)
              then null else p.avatar_url end
  from course_canvas_items i join profiles p on p.id = i.author_id
  where i.id = item and course_is_member(i.course_id);
$$;


ALTER FUNCTION "public"."canvas_author"("item" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cast_vote"("p_poll" "uuid", "p_item" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."cast_vote"("p_poll" "uuid", "p_item" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."charge_tts"("n" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare cap bigint; used bigint; p text; per text := to_char(now(),'YYYY-MM');
begin
  select plan into p from profiles where id = auth.uid();
  select tts_chars_month into cap from plan_limits where plan = coalesce(p,'free');
  insert into usage_meters(user_id, period) values (auth.uid(), per)
    on conflict (user_id, period) do nothing;
  select tts_chars into used from usage_meters where user_id = auth.uid() and period = per;
  if used + n > cap then
    return false;                                  -- over budget → deny
  end if;
  update usage_meters
    set tts_chars = tts_chars + n, tts_requests = tts_requests + 1
    where user_id = auth.uid() and period = per;
  return true;
end;
$$;


ALTER FUNCTION "public"."charge_tts"("n" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compare_shared"("p_token" "text") RETURNS TABLE("id" "uuid", "title" "text", "publication" "jsonb", "stats" "jsonb", "reviewer_text" "text", "zip_public_url" "text", "file_count" integer, "size_bytes" bigint, "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select id, title, publication, stats, reviewer_text, zip_public_url, file_count, size_bytes, created_at
  from public.compare_projects
  where share_token = p_token and is_public = true
  limit 1;
$$;


ALTER FUNCTION "public"."compare_shared"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."course_credit_debit"("p_course" "uuid", "p_service" "text", "p_amount" numeric) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare ok boolean := false;
begin
  update course_credit_budgets
     set used = used + p_amount, updated_at = now()
   where course_id = p_course and user_id = auth.uid() and service = p_service
     and used + p_amount <= granted
  returning true into ok;
  return coalesce(ok, false);
end; $$;


ALTER FUNCTION "public"."course_credit_debit"("p_course" "uuid", "p_service" "text", "p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."course_credit_refund"("p_course" "uuid", "p_user" "uuid", "p_service" "text", "p_amount" numeric) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update course_credit_budgets set used = greatest(0, used - p_amount), updated_at = now()
  where course_id = p_course and user_id = p_user and service = p_service;
$$;


ALTER FUNCTION "public"."course_credit_refund"("p_course" "uuid", "p_user" "uuid", "p_service" "text", "p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."course_is_instructor"("cid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_admin()
      or public.course_role(cid) in ('oktato','demonstrator')
      or exists (select 1 from courses c where c.id = cid and c.owner_id = auth.uid());
$$;


ALTER FUNCTION "public"."course_is_instructor"("cid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."course_is_member"("cid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_admin() or public.course_role(cid) is not null;
$$;


ALTER FUNCTION "public"."course_is_member"("cid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."course_join"("p_code" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare cid uuid;
begin
  if not public.is_active() then raise exception 'A fiók még nincs jóváhagyva.'; end if;
  select id into cid from courses where join_code = p_code and active;
  if cid is null then raise exception 'Érvénytelen kurzuskód'; end if;
  -- review fix: a dropped (instructor-removed) enrollment must NOT re-activate
  -- itself with the join code — the WHERE below skips the update for dropped
  -- rows, so FOUND=false happens EXACTLY in that case (fresh insert and a
  -- non-dropped conflict both set FOUND=true).
  insert into course_enrollments (course_id, user_id, role)
    values (cid, auth.uid(), 'hallgato')
    on conflict (course_id, user_id) do update set status = 'active'
      where course_enrollments.status <> 'dropped';
  if not found then
    raise exception 'A kurzusból eltávolítottak — kérj új hozzáférést az oktatótól.';
  end if;
  return cid;
end; $$;


ALTER FUNCTION "public"."course_join"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."course_role"("cid" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role from course_enrollments
  where course_id = cid and user_id = auth.uid() and status = 'active' limit 1;
$$;


ALTER FUNCTION "public"."course_role"("cid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."distinct_journal_fields"() RETURNS SETOF "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$ select distinct field from journals_ref where field is not null and npi_level>=1 order by 1 $$;


ALTER FUNCTION "public"."distinct_journal_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dm_is_member"("tid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.dm_thread_members m where m.thread_id = tid and m.user_id = auth.uid());
$$;


ALTER FUNCTION "public"."dm_is_member"("tid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dm_start_dm"("p_other" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare tid uuid; me uuid := auth.uid();
begin
  if me is null or p_other is null or p_other = me then return null; end if;
  if not exists (select 1 from public.profiles where id = p_other) then raise exception 'unknown user'; end if;
  -- existing 1:1 thread with EXACTLY {me, other}?
  select t.id into tid from public.dm_threads t
   where t.kind = 'dm'
     and exists (select 1 from public.dm_thread_members m where m.thread_id = t.id and m.user_id = me)
     and exists (select 1 from public.dm_thread_members m where m.thread_id = t.id and m.user_id = p_other)
     and (select count(*) from public.dm_thread_members m where m.thread_id = t.id) = 2
   limit 1;
  if tid is not null then return tid; end if;
  insert into public.dm_threads (kind, created_by) values ('dm', me) returning id into tid;
  insert into public.dm_thread_members (thread_id, user_id) values (tid, me), (tid, p_other);
  return tid;
end; $$;


ALTER FUNCTION "public"."dm_start_dm"("p_other" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dm_start_group"("p_name" "text", "p_members" "uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare tid uuid; me uuid := auth.uid(); mid uuid; cnt int := 0;
begin
  if me is null then return null; end if;
  insert into public.dm_threads (kind, title, created_by)
    values ('group', nullif(btrim(coalesce(p_name, '')), ''), me) returning id into tid;
  insert into public.dm_thread_members (thread_id, user_id) values (tid, me);
  if p_members is not null then
    foreach mid in array p_members loop
      if mid is not null and mid <> me and exists (select 1 from public.profiles where id = mid) then
        insert into public.dm_thread_members (thread_id, user_id) values (tid, mid) on conflict do nothing;
        cnt := cnt + 1;
      end if;
    end loop;
  end if;
  -- a "group" needs at least one other member; otherwise roll it back so we don't leave an empty thread
  if cnt = 0 then delete from public.dm_threads where id = tid; return null; end if;
  return tid;
end; $$;


ALTER FUNCTION "public"."dm_start_group"("p_name" "text", "p_members" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dm_touch_thread"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin update public.dm_threads set updated_at = now() where id = new.thread_id; return new; end; $$;


ALTER FUNCTION "public"."dm_touch_thread"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."effective_model"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with me as (select ai_model, model_allowlist from profiles where id = auth.uid())
  select coalesce(
    (select ai_model from me where public.model_allowed((select ai_model from me))),
    (select model_allowlist[1] from me where model_allowlist is not null),
    (select model_id from allowed_models where active order by sort desc limit 1)  -- cheapest, deterministic
  );
$$;


ALTER FUNCTION "public"."effective_model"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."elicit_mcp_status"() RETURNS TABLE("connected" boolean, "expires_at" timestamp with time zone, "connected_by" "uuid", "connected_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select (o.access_token is not null) as connected, o.expires_at, o.connected_by, o.connected_at
  from elicit_mcp_org o where o.id = 1 and public.is_admin();
$$;


ALTER FUNCTION "public"."elicit_mcp_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_model_allowlist"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.ai_model is not null and new.model_allowlist is not null
     and not (new.ai_model = any(new.model_allowlist)) then
    new.ai_model := new.model_allowlist[1];   -- first allowed, so effective_model() can't escape to env default
  end if;
  return new;
end; $$;


ALTER FUNCTION "public"."enforce_model_allowlist"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."feature_over_budget"("p_key" "text", "max_calls" integer) RETURNS boolean
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select calls from feature_usage
                     where user_id = auth.uid() and feature_key = p_key and day = current_date), 0) >= max_calls;
$$;


ALTER FUNCTION "public"."feature_over_budget"("p_key" "text", "max_calls" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."feature_usage_bump"("p_key" "text") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  insert into feature_usage (user_id, feature_key, day, calls) values (auth.uid(), p_key, current_date, 1)
  on conflict (user_id, feature_key, day) do update set calls = feature_usage.calls + 1;
$$;


ALTER FUNCTION "public"."feature_usage_bump"("p_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_canvas_provenance"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."guard_canvas_provenance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_canvas_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."guard_canvas_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_phd_student_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if public.is_admin() then return new; end if;
  if exists (select 1 from public.phd_supervisions v where v.student_id = old.id and v.supervisor_id = auth.uid() and v.status = 'accepted') then return new; end if;
  if old.supervisor_id = auth.uid() then return new; end if;          -- legacy primary supervisor
  -- otherwise the editor is the student themselves: protect the KPI fields
  new.total_credits := old.total_credits;
  new.status        := old.status;
  new.ethics_status := old.ethics_status;
  new.complex_exam  := old.complex_exam;
  new.supervisor_id := old.supervisor_id;
  return new;
end; $$;


ALTER FUNCTION "public"."guard_phd_student_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_profile_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if public.is_admin() then return new; end if;   -- admins unrestricted
  new.role            := old.role;
  new.features        := old.features;             -- lock entitlements
  new.model_allowlist := old.model_allowlist;
  new.ai_model        := old.ai_model;
  new.can_workflows   := old.can_workflows;
  new.can_figures     := old.can_figures;
  if new.status is distinct from old.status and new.status <> 'pending' then
    new.status := old.status;
  end if;
  return new;
end; $$;


ALTER FUNCTION "public"."guard_profile_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_submission_provenance"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare bad int;
begin
  if auth.uid() is null or course_is_instructor(new.course_id) then return new; end if;
  if new.call_log_ids is not null and array_length(new.call_log_ids, 1) > 0 then
    select count(*) into bad
      from unnest(new.call_log_ids) as cl(id)
      left join mcp_call_log l
        on l.id = cl.id and l.user_id = auth.uid() and l.course_id = new.course_id
     where l.id is null;
    if bad > 0 then
      raise exception 'A call_log_ids csak saját, ehhez a kurzushoz tartozó hívásokat tartalmazhat.';
    end if;
  end if;
  if new.media_path is not null
     and new.media_path not like (new.course_id::text || '/' || auth.uid()::text || '/%') then
    raise exception 'A media_path csak a saját kurzus-mappádra mutathat.';
  end if;
  return new;
end; $$;


ALTER FUNCTION "public"."guard_submission_provenance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare adm boolean := lower(coalesce(new.email,'')) = 'kecskemet.adatkozpont@gmail.com';
begin
  insert into public.profiles (id, email, name, avatar_url, role, status)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name',
                   new.raw_user_meta_data->>'name',
                   split_part(coalesce(new.email,''),'@',1)),
          new.raw_user_meta_data->>'avatar_url',
          case when adm then 'admin' else 'user' end,
          case when adm then 'approved' else 'incomplete' end)
  on conflict (id) do nothing;
  return new;
exception when others then
  raise warning 'handle_new_user failed for %: %', new.id, sqlerrm; return new;
end; $$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_admin()
      or coalesce((select status = 'approved' from profiles where id = auth.uid()), false);
$$;


ALTER FUNCTION "public"."is_active"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_editor"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.editorial_staff e where e.user_id = auth.uid() and e.active);
$$;


ALTER FUNCTION "public"."is_editor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_feature_enabled"("p_key" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when auth.uid() is null then false
    when public.is_admin() then true                                              -- admins have every feature (migration-54)
    when not exists (select 1 from public.profiles where id = auth.uid()) then false
    else (
      public.is_feature_enabled_for(auth.uid(), p_key)                            -- the caller's own grant / catalog default
      or (
        -- inherit from a collaboration: an accepted owner/editor of a project whose OWNER has the feature.
        -- coalesce(...,true) leaves an explicit per-user REVOKE (features->p_key=false) in force.
        -- The two legacy column-gated keys are NEVER inherited (they aren't research features, and their
        -- revoke lives in can_workflows/can_figures, not features->key).
        p_key not in ('session_workflow_mode', 'paper_figure')
        and coalesce((select (features -> p_key)::boolean from public.profiles where id = auth.uid()), true)
        and exists (
          select 1 from public.research_project_members m
          join public.research_projects p on p.id = m.project_id
          where m.user_id = auth.uid() and m.accepted and m.role in ('owner', 'editor')
            and public.is_feature_enabled_for(p.owner_id, p_key)
        )
      )
    )
  end;
$$;


ALTER FUNCTION "public"."is_feature_enabled"("p_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_feature_enabled_for"("p_uid" "uuid", "p_key" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when p_uid is null then false
    when (select role from public.profiles where id = p_uid) = 'admin' then true
    when not exists (select 1 from public.profiles where id = p_uid) then false
    else coalesce(
      (case p_key
         when 'session_workflow_mode' then (select can_workflows from public.profiles where id = p_uid)
         when 'paper_figure'          then (select can_figures   from public.profiles where id = p_uid)
         else null end),
      (select (features -> p_key)::boolean from public.profiles where id = p_uid),
      (select default_on from public.feature_catalog where key = p_key),
      false)
  end;
$$;


ALTER FUNCTION "public"."is_feature_enabled_for"("p_uid" "uuid", "p_key" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."km_nodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "text" NOT NULL,
    "title" "text" NOT NULL,
    "norm_title" "text" NOT NULL,
    "body" "text",
    "project_id" "uuid" NOT NULL,
    "protocol_id" "uuid",
    "step_id" "uuid",
    "source_kind" "text",
    "props" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "fts" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"simple"'::"regconfig", ((COALESCE("title", ''::"text") || ' '::"text") || COALESCE("body", ''::"text")))) STORED,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."km_nodes" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."km_hybrid_search"("query_text" "text", "query_embedding" "extensions"."vector" DEFAULT NULL::"extensions"."vector", "match_count" integer DEFAULT 24, "fts_weight" real DEFAULT 1.0, "vec_weight" real DEFAULT 1.0, "rrf_k" integer DEFAULT 50, "filter_project" "uuid" DEFAULT NULL::"uuid", "filter_kinds" "text"[] DEFAULT NULL::"text"[]) RETURNS SETOF "public"."km_nodes"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  with fts as (
    select id, row_number() over () as rank from (
      select n.id
      from km_nodes n
      where query_text is not null and query_text <> ''
        and n.fts @@ websearch_to_tsquery('simple', query_text)
        and (filter_project is null or n.project_id = filter_project)
        and (filter_kinds  is null or n.kind = any(filter_kinds))
      order by ts_rank_cd(n.fts, websearch_to_tsquery('simple', query_text)) desc
      limit match_count * 2
    ) f
  ),
  vec as (
    select id, row_number() over () as rank from (
      select e.node_id as id
      from km_embeddings e
      join km_nodes n on n.id = e.node_id
      where query_embedding is not null
        and (filter_project is null or e.project_id = filter_project)
        and (filter_kinds  is null or n.kind = any(filter_kinds))
      order by e.embedding <#> query_embedding
      limit match_count * 2
    ) v
  ),
  fused as (
    select coalesce(fts.id, vec.id) as id,
           coalesce(1.0 / (rrf_k + fts.rank), 0) * fts_weight
         + coalesce(1.0 / (rrf_k + vec.rank), 0) * vec_weight as score
    from fts full outer join vec on fts.id = vec.id
  )
  select n.*
  from km_nodes n
  join fused on fused.id = n.id
  order by fused.score desc
  limit match_count;
$$;


ALTER FUNCTION "public"."km_hybrid_search"("query_text" "text", "query_embedding" "extensions"."vector", "match_count" integer, "fts_weight" real, "vec_weight" real, "rrf_k" integer, "filter_project" "uuid", "filter_kinds" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."km_mark_dirty"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if (new.result is distinct from old.result) then
    new.km_ingested_at := null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."km_mark_dirty"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."km_subgraph"("root" "uuid", "max_hops" integer DEFAULT 2) RETURNS TABLE("id" "uuid", "title" "text", "kind" "text", "depth" integer)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  with recursive walk as (
    select n.id, n.title, n.kind, 0 as depth, array[n.id] as path
    from km_nodes n where n.id = root
    union all
    select n2.id, n2.title, n2.kind, w.depth + 1, w.path || n2.id
    from walk w
    join km_edges e on (e.source_id = w.id or e.target_id = w.id)
    join km_nodes n2 on n2.id = case when e.source_id = w.id then e.target_id else e.source_id end
    where w.depth < max_hops and not (n2.id = any(w.path))
  )
  select distinct id, title, kind, depth from walk order by depth;
$$;


ALTER FUNCTION "public"."km_subgraph"("root" "uuid", "max_hops" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."model_allowed"("p_model" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from allowed_models where model_id = p_model and active)
     and coalesce(
           (select model_allowlist is null or p_model = any(model_allowlist)
              from profiles where id = auth.uid()),
           false);                                                                -- missing row = closed
$$;


ALTER FUNCTION "public"."model_allowed"("p_model" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."note_cache_hit"("h" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  update tts_cache set hits = hits + 1, last_used = now() where hash = h;
$$;


ALTER FUNCTION "public"."note_cache_hit"("h" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."phd_can_read_student"("sid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.phd_students s where s.id = sid and (
      public.is_admin() or s.profile_id = auth.uid() or s.supervisor_id = auth.uid()
      or exists (select 1 from public.phd_supervisions v where v.student_id = sid and v.supervisor_id = auth.uid() and v.status = 'accepted')
    )
  );
$$;


ALTER FUNCTION "public"."phd_can_read_student"("sid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."phd_can_write_student"("sid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.phd_students s where s.id = sid and (
      public.is_admin() or s.supervisor_id = auth.uid()
      or exists (select 1 from public.phd_supervisions v where v.student_id = sid and v.supervisor_id = auth.uid() and v.status = 'accepted')
    )
  );
$$;


ALTER FUNCTION "public"."phd_can_write_student"("sid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."phd_owns_student"("sid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.phd_students s where s.id = sid and s.profile_id = auth.uid());
$$;


ALTER FUNCTION "public"."phd_owns_student"("sid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."phd_sync_primary"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status = 'accepted' and new.kind = 'primary' then
    update public.phd_students set supervisor_id = new.supervisor_id, updated_at = now() where id = new.student_id;
  end if;
  if tg_op = 'UPDATE' and new.status <> 'accepted' and old.status = 'accepted' and old.kind = 'primary' then
    update public.phd_students set supervisor_id = null where id = new.student_id and supervisor_id = old.supervisor_id;
  end if;
  return new;
end; $$;


ALTER FUNCTION "public"."phd_sync_primary"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."poll_results"("p_poll" "uuid") RETURNS TABLE("item_id" "uuid", "votes" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select v.item_id, count(*)::bigint
  from course_poll_votes v
  join course_polls p on p.id = v.poll_id
  where v.poll_id = p_poll and course_is_member(p.course_id)
  group by v.item_id
  order by count(*) desc, v.item_id;
$$;


ALTER FUNCTION "public"."poll_results"("p_poll" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pr_accept_invitation"("p_project" "uuid") RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare ts timestamptz;
begin
  update public.project_members
     set accepted_at = coalesce(accepted_at, now())
   where project_id = p_project and user_id = auth.uid()
  returning accepted_at into ts;
  return ts;
end;
$$;


ALTER FUNCTION "public"."pr_accept_invitation"("p_project" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pr_delete_annotation"("p_project" "uuid", "p_ann_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare anns jsonb;
begin
  if public.role_on(p_project) not in ('owner','editor','commenter') then
    raise exception 'no annotation access to project %', p_project using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into anns
    from jsonb_array_elements(coalesce((select data->'annotations' from public.projects where id = p_project), '[]'::jsonb)) e
    where e->>'id' <> p_ann_id;
  update public.projects set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('annotations', anns), updated_at = now() where id = p_project;
end; $$;


ALTER FUNCTION "public"."pr_delete_annotation"("p_project" "uuid", "p_ann_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pr_notify_dm"("p_recipient" "uuid", "p_thread" "uuid", "p_excerpt" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_recipient is null or p_thread is null then return; end if;
  if not public.dm_is_member(p_thread) then raise exception 'not a member of this thread'; end if;   -- only participants may notify
  if not exists (select 1 from public.dm_thread_members m where m.thread_id = p_thread and m.user_id = p_recipient) then return; end if;
  insert into public.notifications (recipient_id, kind, payload)
  values (p_recipient, 'request', jsonb_build_object(
    'type', 'dm', 'thread_id', p_thread,
    'from', (select name from public.profiles where id = auth.uid()), 'from_id', auth.uid(),
    'excerpt', left(coalesce(p_excerpt, ''), 140)));
end; $$;


ALTER FUNCTION "public"."pr_notify_dm"("p_recipient" "uuid", "p_thread" "uuid", "p_excerpt" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pr_notify_research_mention"("p_recipient" "uuid", "p_project" "uuid", "p_title" "text", "p_excerpt" "text", "p_node" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_recipient is null or p_project is null then return; end if;
  if not public.research_can_read_project(p_project) then
    raise exception 'not authorized to notify for this project';
  end if;
  if not exists (select 1 from public.research_project_members m
                 where m.project_id = p_project and m.user_id = p_recipient) then
    return;   -- only notify actual collaborators
  end if;
  insert into public.notifications (recipient_id, kind, payload)
  values (p_recipient, 'request', jsonb_build_object(
    'type', 'research_map_mention', 'project_id', p_project, 'project_title', coalesce(p_title, ''),
    'from', (select name from public.profiles where id = auth.uid()),
    'excerpt', left(coalesce(p_excerpt, ''), 140), 'node_id', p_node));
end;
$$;


ALTER FUNCTION "public"."pr_notify_research_mention"("p_recipient" "uuid", "p_project" "uuid", "p_title" "text", "p_excerpt" "text", "p_node" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pr_notify_research_share"("p_recipient" "uuid", "p_project" "uuid", "p_title" "text", "p_role" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_recipient is null or p_project is null then return; end if;
  if not (public.is_admin() or exists (
        select 1 from public.research_projects p where p.id = p_project and p.owner_id = auth.uid())) then
    raise exception 'not authorized to notify for this project';
  end if;
  insert into public.notifications (recipient_id, kind, payload)
  values (p_recipient, 'share', jsonb_build_object(
    'type', 'research_share', 'project_id', p_project, 'title', coalesce(nullif(p_title, ''), 'Projekt'),
    'role', coalesce(p_role, 'viewer'),
    'by', (select name from public.profiles where id = auth.uid()), 'by_id', auth.uid()));
end;
$$;


ALTER FUNCTION "public"."pr_notify_research_share"("p_recipient" "uuid", "p_project" "uuid", "p_title" "text", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pr_notify_share"("p_recipient" "uuid", "p_project" "uuid", "p_title" "text", "p_role" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_recipient is null or p_project is null then return; end if;
  -- the caller must be the owner or an editor of the referenced project
  if not exists (
    select 1 from public.projects p where p.id = p_project and (
      p.owner_id = auth.uid()
      or exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = auth.uid() and m.role = 'editor')
    )
  ) then
    raise exception 'not authorized to notify for this project';
  end if;
  insert into public.notifications (recipient_id, kind, payload)
  values (p_recipient, 'share', jsonb_build_object(
    'type', 'share', 'project_id', p_project, 'title', coalesce(p_title, 'Untitled project'),
    'role', coalesce(p_role, 'editor'),
    'by', (select name from public.profiles where id = auth.uid()), 'by_id', auth.uid()));
end;
$$;


ALTER FUNCTION "public"."pr_notify_share"("p_recipient" "uuid", "p_project" "uuid", "p_title" "text", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pr_notify_submission"("p_recipient" "uuid", "p_submission" "uuid", "p_kind" "text", "p_title" "text", "p_body" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_recipient is null or p_submission is null then return; end if;
  if not public.sub_can_read(p_submission) then return; end if;
  insert into notifications (recipient_id, kind, payload)
  values (p_recipient, coalesce(p_kind, 'info'),
          jsonb_build_object('title', p_title, 'body', p_body, 'href', 'Submissions.html?s=' || p_submission::text, 'submission_id', p_submission));
end; $$;


ALTER FUNCTION "public"."pr_notify_submission"("p_recipient" "uuid", "p_submission" "uuid", "p_kind" "text", "p_title" "text", "p_body" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pr_save_annotations"("p_project" "uuid", "p_annotations" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if public.role_on(p_project) is null or public.role_on(p_project) not in ('owner', 'editor', 'commenter') then
    raise exception 'no annotation access to project %', p_project using errcode = '42501';
  end if;
  update public.projects
     set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('annotations', coalesce(p_annotations, '[]'::jsonb)),
         updated_at = now()
   where id = p_project and deleted_at is null;
end;
$$;


ALTER FUNCTION "public"."pr_save_annotations"("p_project" "uuid", "p_annotations" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pr_save_project"("p_id" "uuid", "p_owner" "uuid", "p_data" "jsonb", "p_title" "text", "p_deleted_at" timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare ex_id uuid; ex_anns jsonb;
begin
  select id, coalesce(data->'annotations', '[]'::jsonb) into ex_id, ex_anns from public.projects where id = p_id;
  if ex_id is null then
    if p_owner <> auth.uid() then raise exception 'cannot create a project for another owner' using errcode = '42501'; end if;
    insert into public.projects(id, owner_id, title, data, deleted_at, updated_at)
      values (p_id, p_owner, coalesce(p_title, 'Untitled project'), coalesce(p_data, '{}'::jsonb), p_deleted_at, now());
  else
    if public.role_on(p_id) not in ('owner','editor') then raise exception 'no write access to project %', p_id using errcode = '42501'; end if;
    update public.projects set
      data = (coalesce(p_data, '{}'::jsonb) - 'annotations') || jsonb_build_object('annotations', ex_anns),
      title = coalesce(p_title, title),
      -- only the owner can soft-delete/restore; an editor's save preserves the existing deleted_at
      deleted_at = case when public.role_on(p_id) = 'owner' then p_deleted_at else deleted_at end,
      updated_at = now()
    where id = p_id;
  end if;
end; $$;


ALTER FUNCTION "public"."pr_save_project"("p_id" "uuid", "p_owner" "uuid", "p_data" "jsonb", "p_title" "text", "p_deleted_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pr_search_users"("q" "text") RETURNS TABLE("id" "uuid", "name" "text", "avatar_url" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.id, p.name, p.avatar_url from public.profiles p
  where length(coalesce(trim(q), '')) >= 2
    and (p.name ilike '%' || q || '%' or p.email ilike '%' || q || '%')
  order by p.name limit 8;
$$;


ALTER FUNCTION "public"."pr_search_users"("q" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pr_upsert_annotation"("p_project" "uuid", "p_ann" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare anns jsonb; found boolean; aid text;
begin
  if public.role_on(p_project) not in ('owner','editor','commenter') then
    raise exception 'no annotation access to project %', p_project using errcode = '42501';
  end if;
  aid := p_ann->>'id';
  select coalesce(data->'annotations', '[]'::jsonb) into anns from public.projects where id = p_project and deleted_at is null;
  if anns is null then anns := '[]'::jsonb; end if;
  select coalesce(jsonb_agg(case when e->>'id' = aid then p_ann else e end), '[]'::jsonb),
         coalesce(bool_or(e->>'id' = aid), false)
    into anns, found
    from jsonb_array_elements(anns) e;
  if not found then anns := anns || jsonb_build_array(p_ann); end if;
  update public.projects set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('annotations', anns), updated_at = now() where id = p_project;
end; $$;


ALTER FUNCTION "public"."pr_upsert_annotation"("p_project" "uuid", "p_ann" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_cache"("h" "text", "b" integer) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  insert into tts_cache(hash, bytes) values (h, b)
  on conflict (hash) do update set last_used = now();
$$;


ALTER FUNCTION "public"."register_cache"("h" "text", "b" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_can_read_chat"("cid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.research_chats c where c.id = cid and public.research_can_read_project(c.project_id));
$$;


ALTER FUNCTION "public"."research_can_read_chat"("cid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_can_read_project"("pid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_admin()
    or public.research_is_member(pid)
    or exists (
      select 1 from public.research_projects p where p.id = pid and (
        p.owner_id = auth.uid()
        or exists (select 1 from public.phd_students s where s.id = p.student_id
                   and (s.profile_id = auth.uid() or s.supervisor_id = auth.uid()))
        or exists (select 1 from public.phd_supervisions v
                   where v.student_id = p.student_id and v.supervisor_id = auth.uid() and v.status = 'accepted')
      )
    );
$$;


ALTER FUNCTION "public"."research_can_read_project"("pid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_can_write_chat"("cid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.research_chats c
    where c.id = cid
      and public.research_can_write_project(c.project_id)
      and (c.owner_id = auth.uid() or c.owner_id is null)   -- own thread OR the shared team thread
  );
$$;


ALTER FUNCTION "public"."research_can_write_chat"("cid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_can_write_project"("pid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_admin()
    or public.research_is_member(pid, array['owner', 'editor'])
    or exists (select 1 from public.research_projects p where p.id = pid and p.owner_id = auth.uid());
$$;


ALTER FUNCTION "public"."research_can_write_project"("pid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_draft_set_section"("d_id" "uuid", "s_key" "text", "s_latex" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  pid  uuid;
  secs jsonb;
  i    int;
  changed boolean := false;
begin
  select project_id, sections into pid, secs
    from public.research_drafts where id = d_id for update;   -- row lock serializes concurrent section writes
  if pid is null then raise exception 'draft not found'; end if;
  if not (public.is_admin() or public.research_can_write_project(pid)) then
    raise exception 'not authorized to edit this draft';
  end if;
  if secs is null or jsonb_typeof(secs) <> 'array' then return; end if;
  for i in 0 .. jsonb_array_length(secs) - 1 loop
    if secs->i->>'key' = s_key then
      secs := jsonb_set(secs, array[i::text, 'latex'], to_jsonb(s_latex));
      changed := true;
    end if;
  end loop;
  if changed then
    update public.research_drafts set sections = secs, updated_at = now() where id = d_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."research_draft_set_section"("d_id" "uuid", "s_key" "text", "s_latex" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_gap_set_important"("gap_id" "uuid", "val" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare pid uuid;
begin
  select i.project_id into pid from public.research_ideas i where i.id = gap_id and i.source = 'gap';
  if pid is null then raise exception 'gap not found'; end if;
  if not (public.is_admin() or public.research_can_write_project(pid) or public.research_is_supervisor(pid)) then
    raise exception 'not authorized to flag this gap';
  end if;
  update public.research_ideas set gap_important = coalesce(val, false) where id = gap_id;
end;
$$;


ALTER FUNCTION "public"."research_gap_set_important"("gap_id" "uuid", "val" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_guard_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.owner_id is distinct from old.owner_id
     and not (public.is_admin() or auth.uid() = old.owner_id) then
    raise exception 'only the current owner or an admin may transfer ownership';
  end if;
  if new.student_id is distinct from old.student_id
     and not (public.is_admin() or auth.uid() = old.owner_id) then
    raise exception 'only the current owner or an admin may change the linked student';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."research_guard_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_is_member"("pid" "uuid", "roles" "text"[] DEFAULT NULL::"text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.research_project_members m
    where m.project_id = pid and m.user_id = auth.uid() and m.accepted
      and (roles is null or m.role = any(roles))
  );
$$;


ALTER FUNCTION "public"."research_is_member"("pid" "uuid", "roles" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_is_supervisor"("pid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.research_projects p where p.id = pid and (
      exists (select 1 from public.phd_students s where s.id = p.student_id and s.supervisor_id = auth.uid())
      or exists (select 1 from public.phd_supervisions v
                 where v.student_id = p.student_id and v.supervisor_id = auth.uid() and v.status = 'accepted')
    )
  );
$$;


ALTER FUNCTION "public"."research_is_supervisor"("pid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_member_accept"("pid" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.research_project_members set accepted = true
    where project_id = pid and user_id = auth.uid();
$$;


ALTER FUNCTION "public"."research_member_accept"("pid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_step_signoff"("step_id" "uuid", "clear" boolean DEFAULT false) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare pid uuid;
begin
  select pr.project_id into pid
    from public.research_protocol_steps st
    join public.research_protocols pr on pr.id = st.protocol_id
    where st.id = step_id;
  if pid is null then raise exception 'step not found'; end if;
  if not (public.is_admin() or public.research_can_write_project(pid) or public.research_is_supervisor(pid)) then
    raise exception 'not authorized to sign off this step';
  end if;
  update public.research_protocol_steps
    set signed_off_by = case when clear then null else auth.uid() end,
        signed_off_at = case when clear then null else now() end
    where id = step_id;
end;
$$;


ALTER FUNCTION "public"."research_step_signoff"("step_id" "uuid", "clear" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_supervises"("sid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((
    select exists (select 1 from public.phd_students s where s.id = sid and (s.profile_id = auth.uid() or s.supervisor_id = auth.uid()))
        or exists (select 1 from public.phd_supervisions v where v.student_id = sid and v.supervisor_id = auth.uid() and v.status = 'accepted')
  ), false);
$$;


ALTER FUNCTION "public"."research_supervises"("sid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_touch_chat"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$ begin update public.research_chats set updated_at = now() where id = new.chat_id; return new; end; $$;


ALTER FUNCTION "public"."research_touch_chat"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."research_touch_project"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$ begin new.updated_at = now(); return new; end; $$;


ALTER FUNCTION "public"."research_touch_project"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."retract_vote"("p_poll" "uuid", "p_item" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  delete from course_poll_votes
   where poll_id = p_poll and item_id = p_item and voter_id = auth.uid();
  if not found then raise exception 'Nincs visszavonható szavazatod erre az elemre'; end if;
end; $$;


ALTER FUNCTION "public"."retract_vote"("p_poll" "uuid", "p_item" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."role_on"("p" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select case
    when exists (select 1 from projects
                 where id = p and owner_id = auth.uid() and deleted_at is null)
      then 'owner'
    else (select role from project_members
          where project_id = p and user_id = auth.uid())
  end;
$$;


ALTER FUNCTION "public"."role_on"("p" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rotate_join_code"("p_course" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare new_code text;
begin
  if not course_is_instructor(p_course) then
    raise exception 'Csak oktató generálhat új kurzuskódot';
  end if;
  new_code := encode(gen_random_bytes(6),'hex');
  update courses set join_code = new_code where id = p_course;
  if not found then raise exception 'A kurzus nem található'; end if;
  return new_code;
end; $$;


ALTER FUNCTION "public"."rotate_join_code"("p_course" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_research_digests_yesterday"() RETURNS integer
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.build_research_digests((now() - interval '1 day')::date);
$$;


ALTER FUNCTION "public"."run_research_digests_yesterday"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."safe_uuid"("t" "text") RETURNS "uuid"
    LANGUAGE "sql" IMMUTABLE
    AS $_$ select case when t ~ '^[0-9a-fA-F-]{36}$' then t::uuid else null end $_$;


ALTER FUNCTION "public"."safe_uuid"("t" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sub_assign_code"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.manuscript_code is null then
    new.manuscript_code := 'NJE-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('submission_code_seq')::text, 3, '0');
  end if;
  return new;
end; $$;


ALTER FUNCTION "public"."sub_assign_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sub_can_read"("sid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.submissions s where s.id = sid and (s.owner_id = auth.uid()))
      or public.is_editor() or public.is_admin()
      or exists (select 1 from public.submission_reviews r where r.submission_id = sid
                 and r.reviewer_id = auth.uid() and r.status in ('invited','agreed','completed'));
$$;


ALTER FUNCTION "public"."sub_can_read"("sid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sub_touch"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin new.updated_at = now(); return new; end; $$;


ALTER FUNCTION "public"."sub_touch"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "actor_id" "uuid",
    "verb" "text",
    "target" "text",
    "at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."activity" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_usage" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "day" "date" DEFAULT CURRENT_DATE NOT NULL,
    "calls" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."ai_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."allowed_models" (
    "model_id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "sort" integer DEFAULT 100 NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."allowed_models" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."annotations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "file" "text",
    "kind" "text" DEFAULT 'comment'::"text" NOT NULL,
    "anchor" "jsonb",
    "body" "text",
    "author_id" "uuid",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "assignee_id" "uuid",
    "due" "date",
    "replies" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."annotations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audiobooks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "title" "text" NOT NULL,
    "source_kind" "text" DEFAULT 'text'::"text" NOT NULL,
    "source_ref" "text",
    "language" "text",
    "translated" boolean DEFAULT false NOT NULL,
    "voice_id" "text",
    "voice_name" "text",
    "model" "text",
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "segments" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "audio_path" "text",
    "chars" integer,
    "duration_sec" integer,
    "status" "text" DEFAULT 'ready'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audiobooks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bug_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reporter_id" "uuid",
    "title" "text",
    "body" "text" NOT NULL,
    "page" "text",
    "app_version" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "category" "text" DEFAULT 'bug'::"text" NOT NULL,
    "image_data" "text",
    "reply" "text",
    "replied_at" timestamp with time zone,
    "replied_by" "uuid"
);


ALTER TABLE "public"."bug_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."citation_paper_insights" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "source_id" "uuid",
    "rank" integer,
    "s2_id" "text",
    "doi" "text",
    "title" "text",
    "venue" "text",
    "year" integer,
    "cited_by" integer,
    "citing_count" integer,
    "influential" integer,
    "intent_mix" "jsonb",
    "contributions" "jsonb",
    "contexts" "jsonb",
    "summary" "text",
    "done" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."citation_paper_insights" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."citation_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'processing'::"text" NOT NULL,
    "strategy" "text",
    "intent_totals" "jsonb",
    "stats" "jsonb",
    "error" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."citation_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_errors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "page" "text",
    "message" "text" NOT NULL,
    "stack" "text",
    "kind" "text" DEFAULT 'error'::"text",
    "user_agent" "text",
    "app_build" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_errors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."compare_projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner" "uuid" NOT NULL,
    "title" "text" DEFAULT 'Összehasonlítás'::"text" NOT NULL,
    "publication" "jsonb",
    "stats" "jsonb",
    "file_count" integer DEFAULT 0,
    "size_bytes" bigint DEFAULT 0,
    "zip_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewer_text" "text",
    "is_public" boolean DEFAULT false NOT NULL,
    "share_token" "text",
    "zip_public_url" "text",
    "shared_at" timestamp with time zone
);


ALTER TABLE "public"."compare_projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_canvas_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "lecture_id" "uuid",
    "author_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "kind" "text" DEFAULT 'image'::"text" NOT NULL,
    "media_path" "text",
    "media_url" "text",
    "thumb_path" "text",
    "title" "text",
    "prompt" "text" NOT NULL,
    "neg_prompt" "text",
    "model" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "params" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "call_log_id" bigint,
    "x" numeric DEFAULT 0 NOT NULL,
    "y" numeric DEFAULT 0 NOT NULL,
    "w" numeric DEFAULT 320 NOT NULL,
    "h" numeric DEFAULT 240 NOT NULL,
    "anon" boolean DEFAULT false NOT NULL,
    "hidden" boolean DEFAULT false NOT NULL,
    "pinned" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."course_canvas_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_canvas_reactions" (
    "item_id" "uuid" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "emoji" "text" DEFAULT '❤️'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."course_canvas_reactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_credit_budgets" (
    "course_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "service" "text" NOT NULL,
    "granted" numeric DEFAULT 0 NOT NULL,
    "used" numeric DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."course_credit_budgets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_enrollments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'hallgato'::"text" NOT NULL,
    "team" "text",
    "anon_canvas" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."course_enrollments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_lectures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "ord" integer NOT NULL,
    "title" "text" NOT NULL,
    "summary" "text",
    "content_md" "text",
    "held_at" "date",
    "visible" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."course_lectures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_poll_votes" (
    "poll_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "voter_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."course_poll_votes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_polls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "lecture_id" "uuid",
    "title" "text" NOT NULL,
    "category" "text",
    "max_votes_per_voter" integer DEFAULT 3 NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp with time zone
);


ALTER TABLE "public"."course_polls" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."courses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "slug" "text",
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "join_code" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(6), 'hex'::"text") NOT NULL,
    "student_model" "text" DEFAULT 'claude-haiku-4-5-20251001'::"text" NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."courses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dm_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "thread_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "attachments" "jsonb",
    "refs" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."dm_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dm_reads" (
    "thread_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "last_read_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."dm_reads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dm_thread_members" (
    "thread_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."dm_thread_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dm_threads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "text" DEFAULT 'dm'::"text" NOT NULL,
    "title" "text",
    "entity" "jsonb",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."dm_threads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."editorial_staff" (
    "user_id" "uuid" NOT NULL,
    "staff_role" "text" DEFAULT 'editor'::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."editorial_staff" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."elicit_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "project_id" "uuid",
    "kind" "text" DEFAULT 'report'::"text" NOT NULL,
    "elicit_id" "text",
    "research_question" "text",
    "q_hash" "text",
    "status" "text" DEFAULT 'processing'::"text" NOT NULL,
    "stage" "text",
    "url" "text",
    "is_public" boolean DEFAULT false NOT NULL,
    "request" "jsonb",
    "result_title" "text",
    "result_summary" "text",
    "result_body" "text",
    "result_abstract" "text",
    "pdf_url" "text",
    "docx_url" "text",
    "error" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stages" "jsonb",
    "exports" "jsonb",
    "data_freshness" timestamp with time zone
);


ALTER TABLE "public"."elicit_jobs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."elicit_jobs"."stages" IS 'Elicit SR ReviewData — per-stage csv/xlsx download URLs (search/screen/fulltext/extract).';



COMMENT ON COLUMN "public"."elicit_jobs"."exports" IS 'Elicit report/SR export URLs: {pdf,docx,txt,bib,ris}.';



CREATE TABLE IF NOT EXISTS "public"."elicit_mcp_org" (
    "id" integer DEFAULT 1 NOT NULL,
    "client_id" "text",
    "access_token" "text",
    "refresh_token" "text",
    "expires_at" timestamp with time zone,
    "scope" "text",
    "connected_by" "uuid",
    "connected_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "elicit_mcp_org_id_check" CHECK (("id" = 1))
);


ALTER TABLE "public"."elicit_mcp_org" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."elicit_mcp_pending" (
    "state" "text" NOT NULL,
    "code_verifier" "text" NOT NULL,
    "client_id" "text",
    "redirect_uri" "text",
    "admin_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."elicit_mcp_pending" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."elicit_search_cache" (
    "query_hash" "text" NOT NULL,
    "query" "text",
    "corpus" "text",
    "search_mode" "text",
    "filters" "jsonb",
    "results" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "ratelimit" "jsonb",
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."elicit_search_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feature_catalog" (
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "category" "text" DEFAULT 'ai'::"text" NOT NULL,
    "default_on" boolean DEFAULT true NOT NULL,
    "enforced" boolean DEFAULT false NOT NULL,
    "sort" integer DEFAULT 100 NOT NULL
);


ALTER TABLE "public"."feature_catalog" OWNER TO "postgres";


COMMENT ON TABLE "public"."feature_catalog" IS 'Admin-gateable features. enforced=true => server-enforced boundary; false => UI-only convenience (honestly labelled in admin).';



CREATE TABLE IF NOT EXISTS "public"."feature_usage" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "feature_key" "text" NOT NULL,
    "day" "date" DEFAULT CURRENT_DATE NOT NULL,
    "calls" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."feature_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "path" "text" NOT NULL,
    "type" "text" NOT NULL,
    "content" "text",
    "storage_path" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journals_ref" (
    "id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "title_intl" "text",
    "issn_print" "text",
    "issn_online" "text",
    "discipline" "text",
    "field" "text",
    "npi_level" integer,
    "npi_level_year" integer,
    "open_access" "text",
    "country" "text",
    "language" "text",
    "publisher" "text",
    "url" "text",
    "sjr" numeric,
    "sjr_quartile" "text",
    "h_index" integer,
    "scimago_categories" "text",
    "search" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"simple"'::"regconfig", ((((((COALESCE("title", ''::"text") || ' '::"text") || COALESCE("title_intl", ''::"text")) || ' '::"text") || COALESCE("field", ''::"text")) || ' '::"text") || COALESCE("discipline", ''::"text")))) STORED,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."journals_ref" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."km_edges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_id" "uuid" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "rel" "text" NOT NULL,
    "weight" real DEFAULT 1.0 NOT NULL,
    "evidence" "text",
    "project_id" "uuid" NOT NULL,
    "step_id" "uuid",
    "created_by" "uuid",
    "props" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."km_edges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."km_embeddings" (
    "node_id" "uuid" NOT NULL,
    "model" "text" DEFAULT 'gte-small'::"text" NOT NULL,
    "dim" integer DEFAULT 384 NOT NULL,
    "embedding" "extensions"."vector"(384),
    "project_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."km_embeddings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."km_log" (
    "id" bigint NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor" "uuid",
    "op" "text" NOT NULL,
    "node_id" "uuid",
    "project_id" "uuid",
    "note" "text"
);


ALTER TABLE "public"."km_log" OWNER TO "postgres";


ALTER TABLE "public"."km_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."km_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."km_ontology" (
    "id" smallint NOT NULL,
    "kind" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    CONSTRAINT "km_ontology_kind_check" CHECK (("kind" = ANY (ARRAY['node'::"text", 'edge'::"text"])))
);


ALTER TABLE "public"."km_ontology" OWNER TO "postgres";


ALTER TABLE "public"."km_ontology" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."km_ontology_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."lab_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "lecture_id" "uuid" NOT NULL,
    "ord" integer DEFAULT 1 NOT NULL,
    "title" "text" NOT NULL,
    "instructions_md" "text",
    "submit_kinds" "text"[] DEFAULT '{text,link,media}'::"text"[] NOT NULL,
    "mcp_profile" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "due_at" timestamp with time zone,
    "team_based" boolean DEFAULT false NOT NULL,
    "points_max" numeric DEFAULT 10 NOT NULL,
    "rubric" "jsonb",
    "visible" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."lab_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lab_grades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "course_id" "uuid" NOT NULL,
    "grader_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "points" numeric NOT NULL,
    "rubric_scores" "jsonb",
    "feedback_md" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lab_grades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lab_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "assignment_id" "uuid" NOT NULL,
    "course_id" "uuid" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "team" "text",
    "kind" "text" DEFAULT 'text'::"text" NOT NULL,
    "body_text" "text",
    "link_url" "text",
    "media_path" "text",
    "media_mime" "text",
    "canvas_item_id" "uuid",
    "call_log_ids" bigint[],
    "status" "text" DEFAULT 'submitted'::"text" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lab_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."letter_templates" (
    "key" "text" NOT NULL,
    "stage" "text",
    "subject" "text" NOT NULL,
    "body" "text" NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."letter_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mcp_call_log" (
    "id" bigint NOT NULL,
    "course_id" "uuid",
    "assignment_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "server" "text",
    "tool" "text",
    "model" "text",
    "prompt" "text",
    "params" "jsonb",
    "response_meta" "jsonb",
    "credits" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'ok'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mcp_call_log" OWNER TO "postgres";


ALTER TABLE "public"."mcp_call_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."mcp_call_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "kind" "text" DEFAULT 'info'::"text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."phd_degree_requirements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "category" "text",
    "target_value" numeric DEFAULT 0,
    "current_value" numeric DEFAULT 0,
    "unit" "text",
    "is_auto" boolean DEFAULT false,
    "description" "text"
);


ALTER TABLE "public"."phd_degree_requirements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."phd_milestones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "type" "text",
    "credits" integer DEFAULT 0,
    "deadline" "date",
    "status" "text" DEFAULT 'Tervezett'::"text",
    "description" "text",
    "completion_date" "date",
    "proof" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."phd_milestones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."phd_students" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid",
    "name" "text" NOT NULL,
    "email" "text",
    "enrollment_year" integer,
    "supervisor_id" "uuid",
    "topic" "text",
    "status" "text" DEFAULT 'Aktív'::"text" NOT NULL,
    "total_credits" integer DEFAULT 0 NOT NULL,
    "required_credits" integer DEFAULT 240 NOT NULL,
    "ethics_status" "text" DEFAULT 'NONE'::"text",
    "complex_exam" "jsonb",
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."phd_students" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."phd_supervisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "supervisor_id" "uuid" NOT NULL,
    "kind" "text" DEFAULT 'primary'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "message" "text",
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "decided_at" timestamp with time zone
);


ALTER TABLE "public"."phd_supervisions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."phd_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'TODO'::"text",
    "priority" "text" DEFAULT 'MEDIUM'::"text",
    "due_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."phd_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."phd_topics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "supervisor_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "tags" "text"[],
    "status" "text" DEFAULT 'OPEN'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."phd_topics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plan_limits" (
    "plan" "text" NOT NULL,
    "storage_bytes" bigint,
    "tts_chars_month" bigint
);


ALTER TABLE "public"."plan_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prefs" (
    "user_id" "uuid" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."prefs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "name" "text",
    "avatar_url" "text",
    "color" "text" DEFAULT '#4f46e5'::"text" NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "role" "text" DEFAULT 'user'::"text" NOT NULL,
    "status" "text" DEFAULT 'incomplete'::"text" NOT NULL,
    "affiliation" "text",
    "mtmt_id" "text",
    "orcid" "text",
    "position" "text",
    "last_active_at" timestamp with time zone,
    "is_researcher" boolean DEFAULT false NOT NULL,
    "is_supervisor" boolean DEFAULT false NOT NULL,
    "is_student" boolean DEFAULT false NOT NULL,
    "department" "text",
    "capacity_max" integer,
    "research_interests" "text"[],
    "accepting_students" boolean DEFAULT true NOT NULL,
    "ai_model" "text",
    "can_workflows" boolean DEFAULT false NOT NULL,
    "can_figures" boolean DEFAULT false NOT NULL,
    "cost_center_code" "text",
    "cost_center" "text",
    "features" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "model_allowlist" "text"[]
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."ai_model" IS 'Per-user Claude model id for research-chat / research-ai; null = system default. Set by admins.';



COMMENT ON COLUMN "public"."profiles"."can_workflows" IS 'Admin-set: may the user launch Claude workflows in the session.';



COMMENT ON COLUMN "public"."profiles"."can_figures" IS 'Admin-set: may the user generate paper figures (PaperBanana).';



COMMENT ON COLUMN "public"."profiles"."cost_center_code" IS 'JNU Ktg.hely code (e.g. KPSZRHDI01); set when affiliation is John von Neumann University.';



COMMENT ON COLUMN "public"."profiles"."cost_center" IS 'JNU cost center name (Szervezeti egység megnevezése).';



COMMENT ON COLUMN "public"."profiles"."features" IS 'Admin-set per-user feature grants {"<key>":true|false,...}. Absent key = catalog default. Read server-side by is_feature_enabled().';



COMMENT ON COLUMN "public"."profiles"."model_allowlist" IS 'Admin-set allowed Claude model ids. NULL = all active allowed_models. ai_model must be a member (enforced by trigger).';



CREATE OR REPLACE VIEW "public"."profiles_public" AS
 SELECT "id",
    "name",
    "avatar_url",
    "color",
    "plan"
   FROM "public"."profiles";


ALTER VIEW "public"."profiles_public" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_members" (
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "invited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone
);


ALTER TABLE "public"."project_members" OWNER TO "postgres";


COMMENT ON COLUMN "public"."project_members"."accepted_at" IS 'When the invitee accepted the share invitation (null = pending).';



CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "title" "text" DEFAULT 'Untitled project'::"text" NOT NULL,
    "active_file" "text",
    "file_order" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "folders" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "link" "jsonb" DEFAULT '{"role": "viewer", "enabled": false}'::"jsonb" NOT NULL,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "data" "jsonb"
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."publication_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "publication_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "mime" "text",
    "size" bigint DEFAULT 0 NOT NULL,
    "storage_path" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."publication_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."publications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "researcher_id" "uuid" NOT NULL,
    "mtid" bigint,
    "type" "text",
    "type_hu" "text",
    "title" "text",
    "year" integer,
    "first_author" "text",
    "author_count" integer,
    "journal" "text",
    "volume" "text",
    "issue" "text",
    "pages" "text",
    "doi" "text",
    "citations" integer DEFAULT 0,
    "indep_citations" integer DEFAULT 0,
    "oa_type" "text",
    "category" "text",
    "core" boolean,
    "citation" "text",
    "mtmt_url" "text",
    "raw" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."publications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reading_sessions" (
    "user_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "idx" integer DEFAULT 0 NOT NULL,
    "at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reading_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_autopilot_events" (
    "id" bigint NOT NULL,
    "run_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "phase" "text",
    "level" "text" DEFAULT 'run'::"text" NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_autopilot_events" OWNER TO "postgres";


ALTER TABLE "public"."research_autopilot_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."research_autopilot_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."research_autopilot_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "phase_index" integer DEFAULT 0 NOT NULL,
    "phases" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "gate" "jsonb",
    "study_id" "uuid",
    "protocol_id" "uuid",
    "error" "text",
    "driver_token" "uuid",
    "driver_beat" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone
);


ALTER TABLE "public"."research_autopilot_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_canvas" (
    "project_id" "uuid" NOT NULL,
    "data" "jsonb" DEFAULT '{"view": {}, "edges": [], "nodes": []}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid"
);


ALTER TABLE "public"."research_canvas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_chats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "title" "text" DEFAULT 'Consensus chat'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "owner_id" "uuid",
    "surface" "text"
);


ALTER TABLE "public"."research_chats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_datasets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "source" "text" DEFAULT 'url'::"text" NOT NULL,
    "uri" "text",
    "size_bytes" bigint,
    "license" "text",
    "status" "text" DEFAULT 'registered'::"text" NOT NULL,
    "local_path" "text",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_datasets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_draft_suggestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "draft_id" "uuid" NOT NULL,
    "section_key" "text",
    "section_heading" "text",
    "original" "text",
    "suggested" "text" NOT NULL,
    "note" "text",
    "author" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    CONSTRAINT "research_draft_suggestions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."research_draft_suggestions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_drafts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "journal_pick_id" "uuid",
    "title" "text",
    "journal" "text",
    "outline" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sections" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "files" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "editor_project_id" "text",
    "model" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_drafts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_evidence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "chat_id" "uuid" NOT NULL,
    "message_id" "uuid",
    "query" "text",
    "title" "text",
    "doi" "text",
    "year" integer,
    "journal" "text",
    "claim" "text",
    "snippet" "text",
    "url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_evidence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_figures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "source_id" "uuid",
    "page" integer,
    "ord" integer,
    "fig_label" "text",
    "caption" "text",
    "storage_path" "text" NOT NULL,
    "width" integer,
    "height" integer,
    "x" double precision,
    "y" double precision,
    "hidden" boolean DEFAULT false NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "on_map" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."research_figures" OWNER TO "postgres";


COMMENT ON COLUMN "public"."research_figures"."on_map" IS 'Show this figure on the research Map (PipelineCanvas). false = removed from the Map only (not the Figure Board). Default true.';



CREATE TABLE IF NOT EXISTS "public"."research_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "path" "text" NOT NULL,
    "content" "text",
    "storage_path" "text",
    "mime" "text" DEFAULT 'text/markdown'::"text",
    "size" integer DEFAULT 0,
    "source" "text" DEFAULT 'manual'::"text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "chat_id" "uuid"
);


ALTER TABLE "public"."research_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_gami_prefs" (
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "leaderboard_optin" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_gami_prefs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_ideas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "source" "text" DEFAULT 'own'::"text" NOT NULL,
    "question" "text" NOT NULL,
    "hypothesis" "text",
    "rationale" "text",
    "novelty" integer,
    "status" "text" DEFAULT 'candidate'::"text" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "gap_type" "text",
    "evidence" "jsonb",
    "addressed_by_idea_id" "uuid",
    "gap_important" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."research_ideas" OWNER TO "postgres";


COMMENT ON COLUMN "public"."research_ideas"."gap_type" IS 'research-gap taxonomy slug: evidence|knowledge|methodological|population|theoretical|practical|contradictory (migration-83)';



COMMENT ON COLUMN "public"."research_ideas"."evidence" IS 'jsonb array grounding the gap claim: [{source_ref|title, coverage|note}] (migration-83)';



COMMENT ON COLUMN "public"."research_ideas"."addressed_by_idea_id" IS 'the idea row that closes/addresses this gap — set when a gap is promoted to an idea (migration-83)';



COMMENT ON COLUMN "public"."research_ideas"."gap_important" IS 'supervisor/editor "important/approved" flag on a gap (migration-84)';



CREATE TABLE IF NOT EXISTS "public"."research_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "type" "text" DEFAULT 'python'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "spec" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "progress" integer DEFAULT 0 NOT NULL,
    "result" "jsonb",
    "result_path" "text",
    "logs" "text",
    "compute_target" "text" DEFAULT 'self-hosted'::"text" NOT NULL,
    "cost" numeric,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone
);


ALTER TABLE "public"."research_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_journal_picks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "journal_id" bigint,
    "title" "text" NOT NULL,
    "field" "text",
    "npi_level" integer,
    "sjr_quartile" "text",
    "url" "text",
    "fit_score" integer,
    "fit_reason" "text",
    "status" "text" DEFAULT 'suggested'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "template" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."research_journal_picks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "type" "text" DEFAULT 'NOTE'::"text" NOT NULL,
    "summary" "text" NOT NULL,
    "refs" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_map_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "node_id" "text",
    "x" real,
    "y" real,
    "body" "text" NOT NULL,
    "author" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "resolved" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_map_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_map_edges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "edge_key" "text" NOT NULL,
    "from_id" "text" NOT NULL,
    "to_id" "text" NOT NULL,
    "kind" "text",
    "color" "text",
    "anim" "text",
    "line_style" "text",
    "arrow" "text",
    "width" real,
    "label" "text",
    "manual" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "speed" real
);


ALTER TABLE "public"."research_map_edges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_map_frames" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "title" "text" DEFAULT 'Keret'::"text" NOT NULL,
    "x" real DEFAULT 0 NOT NULL,
    "y" real DEFAULT 0 NOT NULL,
    "w" real DEFAULT 420 NOT NULL,
    "h" real DEFAULT 300 NOT NULL,
    "color" "text" DEFAULT 'slate'::"text" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_map_frames" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_map_layout" (
    "project_id" "uuid" NOT NULL,
    "node_id" "text" NOT NULL,
    "x" real NOT NULL,
    "y" real NOT NULL,
    "updated_by" "uuid" DEFAULT "auth"."uid"(),
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hidden" boolean DEFAULT false NOT NULL,
    "pinned" boolean DEFAULT false NOT NULL,
    "card_w" real,
    "card_h" real
);


ALTER TABLE "public"."research_map_layout" OWNER TO "postgres";


COMMENT ON COLUMN "public"."research_map_layout"."hidden" IS 'Hide this node on the Map only (restorable). Does not delete the entity. Default false.';



COMMENT ON COLUMN "public"."research_map_layout"."pinned" IS 'Mark this node important on the Map (pin badge + highlight). Default false.';



COMMENT ON COLUMN "public"."research_map_layout"."card_w" IS 'Manual card width on the Map (px, world units). NULL = auto (default 204).';



COMMENT ON COLUMN "public"."research_map_layout"."card_h" IS 'Manual card height on the Map (px, world units). NULL = auto (measured).';



CREATE TABLE IF NOT EXISTS "public"."research_map_objects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "kind" "text" DEFAULT 'note'::"text" NOT NULL,
    "text" "text",
    "url" "text",
    "storage_path" "text",
    "meta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_map_objects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_map_pages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "name" "text" DEFAULT 'Nézet'::"text" NOT NULL,
    "tx" real DEFAULT 30 NOT NULL,
    "ty" real DEFAULT 18 NOT NULL,
    "k" real DEFAULT 1 NOT NULL,
    "only_pinned" boolean DEFAULT false NOT NULL,
    "ord" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_map_pages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_map_paths" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "name" "text" DEFAULT 'Bemutató'::"text" NOT NULL,
    "ord" integer DEFAULT 0 NOT NULL,
    "steps" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_map_paths" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "chat_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "blocks" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attachments" "jsonb"
);


ALTER TABLE "public"."research_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_notes" (
    "project_id" "uuid" NOT NULL,
    "blocks" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid"
);


ALTER TABLE "public"."research_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_project_members" (
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "invited_by" "uuid" DEFAULT "auth"."uid"(),
    "accepted" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "research_project_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'editor'::"text", 'commenter'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."research_project_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "student_id" "uuid",
    "title" "text" NOT NULL,
    "field" "text",
    "keywords" "text"[],
    "stage" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "goal" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "language" "text" DEFAULT 'en'::"text" NOT NULL
);


ALTER TABLE "public"."research_projects" OWNER TO "postgres";


COMMENT ON COLUMN "public"."research_projects"."language" IS 'Project language for AI-generated content + core UI chrome: en | hu. The user may still request the other language ad hoc for a specific action.';



CREATE TABLE IF NOT EXISTS "public"."research_protocol_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "protocol_id" "uuid" NOT NULL,
    "step_id" "uuid",
    "author_id" "uuid",
    "author_name" "text",
    "kind" "text" DEFAULT 'concern'::"text" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "research_protocol_notes_kind_check" CHECK (("kind" = ANY (ARRAY['concern'::"text", 'obs'::"text", 'dir'::"text"])))
);


ALTER TABLE "public"."research_protocol_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_protocol_steps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "protocol_id" "uuid" NOT NULL,
    "ord" integer NOT NULL,
    "title" "text" NOT NULL,
    "kind" "text" DEFAULT 'custom'::"text" NOT NULL,
    "spec" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "depends_on" integer[] DEFAULT '{}'::integer[] NOT NULL,
    "needs_approval" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'todo'::"text" NOT NULL,
    "result" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assignee" "text" DEFAULT 'ai'::"text" NOT NULL,
    "km_ingested_at" timestamp with time zone,
    "assignee_id" "uuid",
    "signed_off_by" "uuid",
    "signed_off_at" timestamp with time zone,
    CONSTRAINT "rpst_assignee_chk" CHECK (("assignee" = ANY (ARRAY['ai'::"text", 'human'::"text"])))
);


ALTER TABLE "public"."research_protocol_steps" OWNER TO "postgres";


COMMENT ON COLUMN "public"."research_protocol_steps"."assignee_id" IS 'Who is responsible for this step (a project member).';



COMMENT ON COLUMN "public"."research_protocol_steps"."signed_off_by" IS 'Who signed off / approved this step (null = not signed off).';



CREATE TABLE IF NOT EXISTS "public"."research_protocols" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "idea_id" "uuid",
    "title" "text" NOT NULL,
    "goal" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "runner_id" "text",
    "repo" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "env" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "context_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "progress" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "claimed_at" timestamp with time zone,
    "heartbeat_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_protocols" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "source_api" "text" DEFAULT 'manual'::"text" NOT NULL,
    "ext_id" "text",
    "doi" "text",
    "title" "text" NOT NULL,
    "authors" "text"[],
    "year" integer,
    "venue" "text",
    "abstract" "text",
    "cited_by" integer,
    "url" "text",
    "screening" "text" DEFAULT 'unscreened'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "oa_pdf_url" "text",
    "issn" "text",
    "relevance" "text",
    "fig_status" "text"
);


ALTER TABLE "public"."research_sources" OWNER TO "postgres";


COMMENT ON COLUMN "public"."research_sources"."fig_status" IS 'Figure-extraction outcome: ok=figures found, no_oa=no open-access PDF, no_figs=OA PDF had no captioned figures, error=transient (retryable), null=not attempted. Background extractors skip no_oa/no_figs on resume.';



CREATE TABLE IF NOT EXISTS "public"."research_sr_candidates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "idea_id" "uuid",
    "question" "text" NOT NULL,
    "pico" "jsonb",
    "abstract_criteria" "text"[],
    "extraction_questions" "text"[],
    "study_type" "text",
    "dismissed" boolean DEFAULT false NOT NULL,
    "launched_job_id" "uuid",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_sr_candidates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_studies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "idea_id" "uuid",
    "title" "text" NOT NULL,
    "question" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "cur_step" integer DEFAULT 1 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_studies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_study_papers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "study_id" "uuid" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "step" integer NOT NULL,
    "decision" "text" DEFAULT 'unscreened'::"text" NOT NULL,
    "reason" "text",
    "score" integer,
    "signals" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "overridden" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_study_papers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_study_steps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "study_id" "uuid" NOT NULL,
    "step" integer NOT NULL,
    "kind" "text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "cursor" integer DEFAULT 0 NOT NULL,
    "total" integer DEFAULT 0 NOT NULL,
    "counts" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_run_at" timestamp with time zone
);


ALTER TABLE "public"."research_study_steps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_system_prompts" (
    "user_id" "uuid" NOT NULL,
    "prompt" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_system_prompts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "status" "text" DEFAULT 'todo'::"text" NOT NULL,
    "stage" integer,
    "due" "date",
    "assignee_id" "uuid",
    "sort" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."research_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_todos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "title" "text" NOT NULL,
    "notes" "text",
    "assignee" "text" DEFAULT 'human'::"text" NOT NULL,
    "status" "text" DEFAULT 'todo'::"text" NOT NULL,
    "priority" "text",
    "due" "date",
    "sort" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "research_todos_assignee_check" CHECK (("assignee" = ANY (ARRAY['ai'::"text", 'human'::"text"]))),
    CONSTRAINT "research_todos_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'med'::"text", 'high'::"text"]))),
    CONSTRAINT "research_todos_status_check" CHECK (("status" = ANY (ARRAY['todo'::"text", 'doing'::"text", 'blocked'::"text", 'done'::"text"])))
);


ALTER TABLE "public"."research_todos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_daily_reports" (
    "student_id" "uuid" NOT NULL,
    "day" "date" NOT NULL,
    "supervisor_id" "uuid",
    "summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "chat_msgs" integer DEFAULT 0 NOT NULL,
    "log_entries" integer DEFAULT 0 NOT NULL,
    "ideas" integer DEFAULT 0 NOT NULL,
    "sources" integer DEFAULT 0 NOT NULL,
    "jobs" integer DEFAULT 0 NOT NULL,
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "model" "text"
);


ALTER TABLE "public"."student_daily_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submission_authors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "position" integer DEFAULT 1 NOT NULL,
    "name" "text" NOT NULL,
    "email" "text",
    "affiliation" "text",
    "orcid" "text",
    "user_id" "uuid",
    "is_corresponding" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."submission_authors" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."submission_code_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."submission_code_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submission_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "event" "text" NOT NULL,
    "from_status" "text",
    "to_status" "text",
    "detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."submission_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submission_letters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "template_key" "text",
    "subject" "text",
    "body" "text",
    "recipient_user_id" "uuid",
    "sent_by" "uuid",
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."submission_letters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submission_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "round" integer DEFAULT 1 NOT NULL,
    "reviewer_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'invited'::"text" NOT NULL,
    "due_at" timestamp with time zone,
    "coi_declared" boolean DEFAULT false NOT NULL,
    "recommendation" "text",
    "comments_author" "text",
    "comments_editor" "text",
    "invited_by" "uuid",
    "submitted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewer_name" "text"
);


ALTER TABLE "public"."submission_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submission_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "round" integer DEFAULT 0 NOT NULL,
    "kind" "text" DEFAULT 'manuscript'::"text" NOT NULL,
    "storage_path" "text",
    "file_name" "text",
    "size" bigint,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."submission_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "manuscript_code" "text",
    "owner_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "abstract" "text",
    "keywords" "text"[],
    "article_type" "text" DEFAULT 'article'::"text" NOT NULL,
    "journal_ref_id" bigint,
    "venue_text" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "round" integer DEFAULT 0 NOT NULL,
    "handling_editor_id" "uuid",
    "editor_project_id" "text",
    "declarations" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "cover_letter" "text",
    "submitted_at" timestamp with time zone,
    "decided_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."submissions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."supervisors_public" AS
 SELECT "id",
    "name",
    "avatar_url",
    "department",
    "position",
    "research_interests",
    "capacity_max",
    "accepting_students"
   FROM "public"."profiles"
  WHERE ("is_supervisor" = true);


ALTER VIEW "public"."supervisors_public" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tts_cache" (
    "hash" "text" NOT NULL,
    "bytes" integer DEFAULT 0 NOT NULL,
    "hits" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tts_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usage_meters" (
    "user_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "storage_bytes" bigint DEFAULT 0 NOT NULL,
    "tts_chars" bigint DEFAULT 0 NOT NULL,
    "tts_requests" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."usage_meters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_chat_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "chat_id" "uuid" NOT NULL,
    "path" "text" NOT NULL,
    "content" "text",
    "source" "text" DEFAULT 'agent'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_chat_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "chat_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "content" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_chat_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_chats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "title" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_chats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "label" "text",
    "named" boolean DEFAULT false NOT NULL,
    "author_id" "uuid",
    "files" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."versions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."activity"
    ADD CONSTRAINT "activity_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_usage"
    ADD CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("user_id", "day");



ALTER TABLE ONLY "public"."allowed_models"
    ADD CONSTRAINT "allowed_models_pkey" PRIMARY KEY ("model_id");



ALTER TABLE ONLY "public"."annotations"
    ADD CONSTRAINT "annotations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audiobooks"
    ADD CONSTRAINT "audiobooks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bug_reports"
    ADD CONSTRAINT "bug_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."citation_paper_insights"
    ADD CONSTRAINT "citation_paper_insights_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."citation_reports"
    ADD CONSTRAINT "citation_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_errors"
    ADD CONSTRAINT "client_errors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compare_projects"
    ADD CONSTRAINT "compare_projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_canvas_items"
    ADD CONSTRAINT "course_canvas_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_canvas_reactions"
    ADD CONSTRAINT "course_canvas_reactions_pkey" PRIMARY KEY ("item_id", "user_id", "emoji");



ALTER TABLE ONLY "public"."course_credit_budgets"
    ADD CONSTRAINT "course_credit_budgets_pkey" PRIMARY KEY ("course_id", "user_id", "service");



ALTER TABLE ONLY "public"."course_enrollments"
    ADD CONSTRAINT "course_enrollments_course_id_user_id_key" UNIQUE ("course_id", "user_id");



ALTER TABLE ONLY "public"."course_enrollments"
    ADD CONSTRAINT "course_enrollments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_lectures"
    ADD CONSTRAINT "course_lectures_course_id_ord_key" UNIQUE ("course_id", "ord");



ALTER TABLE ONLY "public"."course_lectures"
    ADD CONSTRAINT "course_lectures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_poll_votes"
    ADD CONSTRAINT "course_poll_votes_pkey" PRIMARY KEY ("poll_id", "item_id", "voter_id");



ALTER TABLE ONLY "public"."course_polls"
    ADD CONSTRAINT "course_polls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_join_code_key" UNIQUE ("join_code");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."dm_messages"
    ADD CONSTRAINT "dm_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dm_reads"
    ADD CONSTRAINT "dm_reads_pkey" PRIMARY KEY ("thread_id", "user_id");



ALTER TABLE ONLY "public"."dm_thread_members"
    ADD CONSTRAINT "dm_thread_members_pkey" PRIMARY KEY ("thread_id", "user_id");



ALTER TABLE ONLY "public"."dm_threads"
    ADD CONSTRAINT "dm_threads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."editorial_staff"
    ADD CONSTRAINT "editorial_staff_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."elicit_jobs"
    ADD CONSTRAINT "elicit_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."elicit_mcp_org"
    ADD CONSTRAINT "elicit_mcp_org_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."elicit_mcp_pending"
    ADD CONSTRAINT "elicit_mcp_pending_pkey" PRIMARY KEY ("state");



ALTER TABLE ONLY "public"."elicit_search_cache"
    ADD CONSTRAINT "elicit_search_cache_pkey" PRIMARY KEY ("query_hash");



ALTER TABLE ONLY "public"."feature_catalog"
    ADD CONSTRAINT "feature_catalog_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."feature_usage"
    ADD CONSTRAINT "feature_usage_pkey" PRIMARY KEY ("user_id", "feature_key", "day");



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_project_id_path_key" UNIQUE ("project_id", "path");



ALTER TABLE ONLY "public"."journals_ref"
    ADD CONSTRAINT "journals_ref_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."km_edges"
    ADD CONSTRAINT "km_edges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."km_edges"
    ADD CONSTRAINT "km_edges_source_id_target_id_rel_key" UNIQUE ("source_id", "target_id", "rel");



ALTER TABLE ONLY "public"."km_embeddings"
    ADD CONSTRAINT "km_embeddings_pkey" PRIMARY KEY ("node_id");



ALTER TABLE ONLY "public"."km_log"
    ADD CONSTRAINT "km_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."km_nodes"
    ADD CONSTRAINT "km_nodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."km_ontology"
    ADD CONSTRAINT "km_ontology_kind_name_key" UNIQUE ("kind", "name");



ALTER TABLE ONLY "public"."km_ontology"
    ADD CONSTRAINT "km_ontology_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lab_assignments"
    ADD CONSTRAINT "lab_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lab_grades"
    ADD CONSTRAINT "lab_grades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lab_grades"
    ADD CONSTRAINT "lab_grades_submission_id_key" UNIQUE ("submission_id");



ALTER TABLE ONLY "public"."lab_submissions"
    ADD CONSTRAINT "lab_submissions_assignment_id_user_id_key" UNIQUE ("assignment_id", "user_id");



ALTER TABLE ONLY "public"."lab_submissions"
    ADD CONSTRAINT "lab_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."letter_templates"
    ADD CONSTRAINT "letter_templates_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."mcp_call_log"
    ADD CONSTRAINT "mcp_call_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phd_degree_requirements"
    ADD CONSTRAINT "phd_degree_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phd_milestones"
    ADD CONSTRAINT "phd_milestones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phd_students"
    ADD CONSTRAINT "phd_students_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phd_supervisions"
    ADD CONSTRAINT "phd_supervisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phd_supervisions"
    ADD CONSTRAINT "phd_supervisions_student_id_supervisor_id_key" UNIQUE ("student_id", "supervisor_id");



ALTER TABLE ONLY "public"."phd_tasks"
    ADD CONSTRAINT "phd_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phd_topics"
    ADD CONSTRAINT "phd_topics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plan_limits"
    ADD CONSTRAINT "plan_limits_pkey" PRIMARY KEY ("plan");



ALTER TABLE ONLY "public"."prefs"
    ADD CONSTRAINT "prefs_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_pkey" PRIMARY KEY ("project_id", "user_id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."publication_files"
    ADD CONSTRAINT "publication_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."publications"
    ADD CONSTRAINT "publications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."publications"
    ADD CONSTRAINT "publications_researcher_id_mtid_key" UNIQUE ("researcher_id", "mtid");



ALTER TABLE ONLY "public"."reading_sessions"
    ADD CONSTRAINT "reading_sessions_pkey" PRIMARY KEY ("user_id", "project_id");



ALTER TABLE ONLY "public"."research_autopilot_events"
    ADD CONSTRAINT "research_autopilot_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_autopilot_runs"
    ADD CONSTRAINT "research_autopilot_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_canvas"
    ADD CONSTRAINT "research_canvas_pkey" PRIMARY KEY ("project_id");



ALTER TABLE ONLY "public"."research_chats"
    ADD CONSTRAINT "research_chats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_datasets"
    ADD CONSTRAINT "research_datasets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_draft_suggestions"
    ADD CONSTRAINT "research_draft_suggestions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_drafts"
    ADD CONSTRAINT "research_drafts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_evidence"
    ADD CONSTRAINT "research_evidence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_figures"
    ADD CONSTRAINT "research_figures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_figures"
    ADD CONSTRAINT "research_figures_source_id_ord_key" UNIQUE ("source_id", "ord");



ALTER TABLE ONLY "public"."research_files"
    ADD CONSTRAINT "research_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_files"
    ADD CONSTRAINT "research_files_project_id_path_key" UNIQUE ("project_id", "path");



ALTER TABLE ONLY "public"."research_gami_prefs"
    ADD CONSTRAINT "research_gami_prefs_pkey" PRIMARY KEY ("project_id", "user_id");



ALTER TABLE ONLY "public"."research_ideas"
    ADD CONSTRAINT "research_ideas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_jobs"
    ADD CONSTRAINT "research_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_journal_picks"
    ADD CONSTRAINT "research_journal_picks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_log"
    ADD CONSTRAINT "research_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_map_comments"
    ADD CONSTRAINT "research_map_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_map_edges"
    ADD CONSTRAINT "research_map_edges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_map_edges"
    ADD CONSTRAINT "research_map_edges_project_id_edge_key_key" UNIQUE ("project_id", "edge_key");



ALTER TABLE ONLY "public"."research_map_frames"
    ADD CONSTRAINT "research_map_frames_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_map_layout"
    ADD CONSTRAINT "research_map_layout_pkey" PRIMARY KEY ("project_id", "node_id");



ALTER TABLE ONLY "public"."research_map_objects"
    ADD CONSTRAINT "research_map_objects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_map_pages"
    ADD CONSTRAINT "research_map_pages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_map_paths"
    ADD CONSTRAINT "research_map_paths_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_messages"
    ADD CONSTRAINT "research_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_notes"
    ADD CONSTRAINT "research_notes_pkey" PRIMARY KEY ("project_id");



ALTER TABLE ONLY "public"."research_project_members"
    ADD CONSTRAINT "research_project_members_pkey" PRIMARY KEY ("project_id", "user_id");



ALTER TABLE ONLY "public"."research_projects"
    ADD CONSTRAINT "research_projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_protocol_notes"
    ADD CONSTRAINT "research_protocol_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_protocol_steps"
    ADD CONSTRAINT "research_protocol_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_protocol_steps"
    ADD CONSTRAINT "research_protocol_steps_protocol_id_ord_key" UNIQUE ("protocol_id", "ord");



ALTER TABLE ONLY "public"."research_protocols"
    ADD CONSTRAINT "research_protocols_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_sources"
    ADD CONSTRAINT "research_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_sources"
    ADD CONSTRAINT "research_sources_project_id_ext_id_key" UNIQUE ("project_id", "ext_id");



ALTER TABLE ONLY "public"."research_sr_candidates"
    ADD CONSTRAINT "research_sr_candidates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_sr_candidates"
    ADD CONSTRAINT "research_sr_candidates_project_id_idea_id_key" UNIQUE ("project_id", "idea_id");



ALTER TABLE ONLY "public"."research_studies"
    ADD CONSTRAINT "research_studies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_study_papers"
    ADD CONSTRAINT "research_study_papers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_study_papers"
    ADD CONSTRAINT "research_study_papers_study_id_source_id_step_key" UNIQUE ("study_id", "source_id", "step");



ALTER TABLE ONLY "public"."research_study_steps"
    ADD CONSTRAINT "research_study_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_study_steps"
    ADD CONSTRAINT "research_study_steps_study_id_step_key" UNIQUE ("study_id", "step");



ALTER TABLE ONLY "public"."research_system_prompts"
    ADD CONSTRAINT "research_system_prompts_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."research_tasks"
    ADD CONSTRAINT "research_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_todos"
    ADD CONSTRAINT "research_todos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_daily_reports"
    ADD CONSTRAINT "student_daily_reports_pkey" PRIMARY KEY ("student_id", "day");



ALTER TABLE ONLY "public"."submission_authors"
    ADD CONSTRAINT "submission_authors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submission_events"
    ADD CONSTRAINT "submission_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submission_letters"
    ADD CONSTRAINT "submission_letters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submission_reviews"
    ADD CONSTRAINT "submission_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submission_reviews"
    ADD CONSTRAINT "submission_reviews_submission_id_round_reviewer_id_key" UNIQUE ("submission_id", "round", "reviewer_id");



ALTER TABLE ONLY "public"."submission_versions"
    ADD CONSTRAINT "submission_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_manuscript_code_key" UNIQUE ("manuscript_code");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tts_cache"
    ADD CONSTRAINT "tts_cache_pkey" PRIMARY KEY ("hash");



ALTER TABLE ONLY "public"."usage_meters"
    ADD CONSTRAINT "usage_meters_pkey" PRIMARY KEY ("user_id", "period");



ALTER TABLE ONLY "public"."user_chat_files"
    ADD CONSTRAINT "user_chat_files_chat_id_path_key" UNIQUE ("chat_id", "path");



ALTER TABLE ONLY "public"."user_chat_files"
    ADD CONSTRAINT "user_chat_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_chat_messages"
    ADD CONSTRAINT "user_chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_chats"
    ADD CONSTRAINT "user_chats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."versions"
    ADD CONSTRAINT "versions_pkey" PRIMARY KEY ("id");



CREATE INDEX "ab_owner_idx" ON "public"."audiobooks" USING "btree" ("owner_id");



CREATE INDEX "activity_project_idx" ON "public"."activity" USING "btree" ("project_id", "at" DESC);



CREATE INDEX "ai_usage_day_idx" ON "public"."ai_usage" USING "btree" ("day");



CREATE INDEX "annotations_project_idx" ON "public"."annotations" USING "btree" ("project_id");



CREATE INDEX "br_created_idx" ON "public"."bug_reports" USING "btree" ("created_at" DESC);



CREATE INDEX "br_reporter_idx" ON "public"."bug_reports" USING "btree" ("reporter_id");



CREATE INDEX "br_status_idx" ON "public"."bug_reports" USING "btree" ("status");



CREATE INDEX "cci_author_idx" ON "public"."course_canvas_items" USING "btree" ("author_id");



CREATE INDEX "cci_course_idx" ON "public"."course_canvas_items" USING "btree" ("course_id", "lecture_id");



CREATE INDEX "ce_course_idx" ON "public"."course_enrollments" USING "btree" ("course_id");



CREATE INDEX "ce_user_idx" ON "public"."course_enrollments" USING "btree" ("user_id");



CREATE INDEX "citation_insights_report_idx" ON "public"."citation_paper_insights" USING "btree" ("report_id", "rank");



CREATE INDEX "citation_reports_project_idx" ON "public"."citation_reports" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "client_errors_created_idx" ON "public"."client_errors" USING "btree" ("created_at" DESC);



CREATE INDEX "compare_projects_owner_idx" ON "public"."compare_projects" USING "btree" ("owner", "created_at" DESC);



CREATE UNIQUE INDEX "compare_projects_share_token_idx" ON "public"."compare_projects" USING "btree" ("share_token") WHERE ("share_token" IS NOT NULL);



CREATE INDEX "cp_course_idx" ON "public"."course_polls" USING "btree" ("course_id", "created_at" DESC);



CREATE INDEX "cpv_poll_idx" ON "public"."course_poll_votes" USING "btree" ("poll_id", "item_id");



CREATE INDEX "dm_msg_thread_idx" ON "public"."dm_messages" USING "btree" ("thread_id", "created_at");



CREATE INDEX "dm_tm_user_idx" ON "public"."dm_thread_members" USING "btree" ("user_id");



CREATE INDEX "elicit_jobs_active_idx" ON "public"."elicit_jobs" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['processing'::"text", 'pausedForInsufficientQuota'::"text", 'unknown'::"text"]));



CREATE UNIQUE INDEX "elicit_jobs_pending_uniq" ON "public"."elicit_jobs" USING "btree" ("user_id", "kind", "q_hash") WHERE ("status" <> ALL (ARRAY['completed'::"text", 'failed'::"text"]));



CREATE INDEX "elicit_jobs_user_idx" ON "public"."elicit_jobs" USING "btree" ("user_id", "kind", "created_at" DESC);



CREATE INDEX "elicit_search_cache_fetched_idx" ON "public"."elicit_search_cache" USING "btree" ("fetched_at");



CREATE INDEX "feature_usage_day_idx" ON "public"."feature_usage" USING "btree" ("day");



CREATE INDEX "files_project_idx" ON "public"."files" USING "btree" ("project_id");



CREATE INDEX "journals_ref_field_idx" ON "public"."journals_ref" USING "btree" ("field");



CREATE INDEX "journals_ref_issn_o_idx" ON "public"."journals_ref" USING "btree" ("issn_online");



CREATE INDEX "journals_ref_issn_p_idx" ON "public"."journals_ref" USING "btree" ("issn_print");



CREATE INDEX "journals_ref_level_idx" ON "public"."journals_ref" USING "btree" ("npi_level");



CREATE INDEX "journals_ref_search_idx" ON "public"."journals_ref" USING "gin" ("search");



CREATE INDEX "km_edges_project" ON "public"."km_edges" USING "btree" ("project_id");



CREATE INDEX "km_edges_rel" ON "public"."km_edges" USING "btree" ("rel");



CREATE INDEX "km_edges_source" ON "public"."km_edges" USING "btree" ("source_id");



CREATE INDEX "km_edges_target" ON "public"."km_edges" USING "btree" ("target_id");



CREATE INDEX "km_emb_hnsw" ON "public"."km_embeddings" USING "hnsw" ("embedding" "extensions"."vector_ip_ops");



CREATE INDEX "km_log_project" ON "public"."km_log" USING "btree" ("project_id", "ts" DESC);



CREATE INDEX "km_log_ts" ON "public"."km_log" USING "btree" ("ts" DESC);



CREATE UNIQUE INDEX "km_nodes_dedup" ON "public"."km_nodes" USING "btree" ("project_id", "kind", "norm_title");



CREATE INDEX "km_nodes_fts" ON "public"."km_nodes" USING "gin" ("fts");



CREATE INDEX "km_nodes_kind" ON "public"."km_nodes" USING "btree" ("kind");



CREATE INDEX "km_nodes_normttl" ON "public"."km_nodes" USING "btree" ("norm_title");



CREATE INDEX "km_nodes_project" ON "public"."km_nodes" USING "btree" ("project_id");



CREATE INDEX "km_nodes_step" ON "public"."km_nodes" USING "btree" ("step_id");



CREATE INDEX "la_course_idx" ON "public"."lab_assignments" USING "btree" ("course_id", "lecture_id");



CREATE INDEX "ls_assignment_idx" ON "public"."lab_submissions" USING "btree" ("assignment_id");



CREATE INDEX "ls_course_user_idx" ON "public"."lab_submissions" USING "btree" ("course_id", "user_id");



CREATE INDEX "mcl_course_idx" ON "public"."mcp_call_log" USING "btree" ("course_id", "created_at" DESC);



CREATE INDEX "mcl_user_idx" ON "public"."mcp_call_log" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "members_user_idx" ON "public"."project_members" USING "btree" ("user_id");



CREATE INDEX "nf_recipient_idx" ON "public"."notifications" USING "btree" ("recipient_id", "read_at");



CREATE INDEX "phd_degree_req_student_idx" ON "public"."phd_degree_requirements" USING "btree" ("student_id");



CREATE INDEX "phd_milestones_student_idx" ON "public"."phd_milestones" USING "btree" ("student_id");



CREATE INDEX "phd_students_profile_idx" ON "public"."phd_students" USING "btree" ("profile_id");



CREATE UNIQUE INDEX "phd_students_profile_uniq" ON "public"."phd_students" USING "btree" ("profile_id") WHERE ("profile_id" IS NOT NULL);



CREATE INDEX "phd_students_supervisor_idx" ON "public"."phd_students" USING "btree" ("supervisor_id");



CREATE INDEX "phd_sv_student_idx" ON "public"."phd_supervisions" USING "btree" ("student_id");



CREATE INDEX "phd_sv_supervisor_idx" ON "public"."phd_supervisions" USING "btree" ("supervisor_id");



CREATE INDEX "phd_tasks_student_idx" ON "public"."phd_tasks" USING "btree" ("student_id");



CREATE INDEX "phd_topics_supervisor_idx" ON "public"."phd_topics" USING "btree" ("supervisor_id");



CREATE INDEX "projects_live_idx" ON "public"."projects" USING "btree" ("updated_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "projects_owner_idx" ON "public"."projects" USING "btree" ("owner_id");



CREATE INDEX "publication_files_owner_idx" ON "public"."publication_files" USING "btree" ("owner_id");



CREATE INDEX "publication_files_pub_idx" ON "public"."publication_files" USING "btree" ("publication_id");



CREATE INDEX "publications_researcher_idx" ON "public"."publications" USING "btree" ("researcher_id");



CREATE INDEX "publications_year_idx" ON "public"."publications" USING "btree" ("researcher_id", "year" DESC);



CREATE INDEX "rae_run_idx" ON "public"."research_autopilot_events" USING "btree" ("run_id", "id");



CREATE INDEX "rar_owner_idx" ON "public"."research_autopilot_runs" USING "btree" ("owner_id");



CREATE INDEX "rar_project_idx" ON "public"."research_autopilot_runs" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "rc_project_idx" ON "public"."research_chats" USING "btree" ("project_id");



CREATE INDEX "rd_project_idx" ON "public"."research_datasets" USING "btree" ("project_id");



CREATE INDEX "rdr_project_idx" ON "public"."research_drafts" USING "btree" ("project_id");



CREATE INDEX "rds_draft_idx" ON "public"."research_draft_suggestions" USING "btree" ("draft_id");



CREATE INDEX "rds_project_idx" ON "public"."research_draft_suggestions" USING "btree" ("project_id");



CREATE INDEX "re_chat_idx" ON "public"."research_evidence" USING "btree" ("chat_id");



CREATE UNIQUE INDEX "research_chats_surface_owner_uk" ON "public"."research_chats" USING "btree" ("project_id", "surface", COALESCE("owner_id", '00000000-0000-0000-0000-000000000000'::"uuid"));



CREATE INDEX "research_figures_project_idx" ON "public"."research_figures" USING "btree" ("project_id", "created_at");



CREATE INDEX "research_files_chat_idx" ON "public"."research_files" USING "btree" ("chat_id");



CREATE INDEX "research_ideas_gap_idx" ON "public"."research_ideas" USING "btree" ("project_id") WHERE ("source" = 'gap'::"text");



CREATE INDEX "research_sr_candidates_project_idx" ON "public"."research_sr_candidates" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "rf_project_idx" ON "public"."research_files" USING "btree" ("project_id");



CREATE INDEX "ri_project_idx" ON "public"."research_ideas" USING "btree" ("project_id");



CREATE INDEX "rj_project_idx" ON "public"."research_jobs" USING "btree" ("project_id");



CREATE INDEX "rj_status_idx" ON "public"."research_jobs" USING "btree" ("status") WHERE ("status" = 'queued'::"text");



CREATE INDEX "rjp_project_idx" ON "public"."research_journal_picks" USING "btree" ("project_id");



CREATE INDEX "rl_project_idx" ON "public"."research_log" USING "btree" ("project_id", "ts" DESC);



CREATE INDEX "rm_chat_idx" ON "public"."research_messages" USING "btree" ("chat_id", "created_at");



CREATE INDEX "rmc_project_idx" ON "public"."research_map_comments" USING "btree" ("project_id");



CREATE INDEX "rmedge_project_idx" ON "public"."research_map_edges" USING "btree" ("project_id");



CREATE INDEX "rmf_project_idx" ON "public"."research_map_frames" USING "btree" ("project_id");



CREATE INDEX "rml_project_idx" ON "public"."research_map_layout" USING "btree" ("project_id");



CREATE INDEX "rmo_project_idx" ON "public"."research_map_objects" USING "btree" ("project_id");



CREATE INDEX "rmp_project_idx" ON "public"."research_map_pages" USING "btree" ("project_id");



CREATE INDEX "rmpath_project_idx" ON "public"."research_map_paths" USING "btree" ("project_id");



CREATE INDEX "rp_owner_idx" ON "public"."research_projects" USING "btree" ("owner_id");



CREATE INDEX "rp_student_idx" ON "public"."research_projects" USING "btree" ("student_id");



CREATE INDEX "rpm_project_idx" ON "public"."research_project_members" USING "btree" ("project_id");



CREATE INDEX "rpm_user_idx" ON "public"."research_project_members" USING "btree" ("user_id");



CREATE INDEX "rpn_project_idx" ON "public"."research_protocol_notes" USING "btree" ("project_id");



CREATE INDEX "rpn_protocol_idx" ON "public"."research_protocol_notes" USING "btree" ("protocol_id");



CREATE INDEX "rpn_step_idx" ON "public"."research_protocol_notes" USING "btree" ("step_id");



CREATE UNIQUE INDEX "rprot_one_active_per_user" ON "public"."research_protocols" USING "btree" ("project_id", "created_by") WHERE ("status" <> ALL (ARRAY['archived'::"text", 'done'::"text"]));



CREATE INDEX "rprot_project_idx" ON "public"."research_protocols" USING "btree" ("project_id");



CREATE INDEX "rpst_km_todo" ON "public"."research_protocol_steps" USING "btree" ("finished_at") WHERE (("status" = 'done'::"text") AND ("km_ingested_at" IS NULL));



CREATE INDEX "rpst_protocol_idx" ON "public"."research_protocol_steps" USING "btree" ("protocol_id", "ord");



CREATE INDEX "rs_project_idx" ON "public"."research_sources" USING "btree" ("project_id");



CREATE INDEX "rst_project_idx" ON "public"."research_studies" USING "btree" ("project_id");



CREATE INDEX "rstp_source_idx" ON "public"."research_study_papers" USING "btree" ("source_id");



CREATE INDEX "rstp_study_step_idx" ON "public"."research_study_papers" USING "btree" ("study_id", "step");



CREATE INDEX "rsts_study_idx" ON "public"."research_study_steps" USING "btree" ("study_id");



CREATE INDEX "rt_project_idx" ON "public"."research_tasks" USING "btree" ("project_id");



CREATE INDEX "rtd_owner_idx" ON "public"."research_todos" USING "btree" ("owner_id");



CREATE INDEX "rtd_project_idx" ON "public"."research_todos" USING "btree" ("project_id");



CREATE INDEX "rtd_status_idx" ON "public"."research_todos" USING "btree" ("owner_id", "status");



CREATE INDEX "sub_owner_idx" ON "public"."submissions" USING "btree" ("owner_id");



CREATE INDEX "sub_status_idx" ON "public"."submissions" USING "btree" ("status");



CREATE INDEX "suba_sub_idx" ON "public"."submission_authors" USING "btree" ("submission_id");



CREATE INDEX "sube_sub_idx" ON "public"."submission_events" USING "btree" ("submission_id", "created_at");



CREATE INDEX "subl_sub_idx" ON "public"."submission_letters" USING "btree" ("submission_id");



CREATE INDEX "subr_rev_idx" ON "public"."submission_reviews" USING "btree" ("reviewer_id");



CREATE INDEX "subr_sub_idx" ON "public"."submission_reviews" USING "btree" ("submission_id", "round");



CREATE INDEX "subv_sub_idx" ON "public"."submission_versions" USING "btree" ("submission_id", "round");



CREATE INDEX "tts_cache_lru_idx" ON "public"."tts_cache" USING "btree" ("last_used");



CREATE INDEX "uc_owner_idx" ON "public"."user_chats" USING "btree" ("owner_id");



CREATE INDEX "ucf_chat_idx" ON "public"."user_chat_files" USING "btree" ("chat_id");



CREATE INDEX "ucm_chat_idx" ON "public"."user_chat_messages" USING "btree" ("chat_id");



CREATE INDEX "versions_project_idx" ON "public"."versions" USING "btree" ("project_id", "created_at" DESC);



CREATE OR REPLACE TRIGGER "dm_msg_touch" AFTER INSERT ON "public"."dm_messages" FOR EACH ROW EXECUTE FUNCTION "public"."dm_touch_thread"();



CREATE OR REPLACE TRIGGER "enforce_model_allowlist" BEFORE INSERT OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_model_allowlist"();



CREATE OR REPLACE TRIGGER "guard_canvas_provenance_trg" BEFORE INSERT OR UPDATE ON "public"."course_canvas_items" FOR EACH ROW EXECUTE FUNCTION "public"."guard_canvas_provenance"();



CREATE OR REPLACE TRIGGER "guard_canvas_update_trg" BEFORE UPDATE ON "public"."course_canvas_items" FOR EACH ROW EXECUTE FUNCTION "public"."guard_canvas_update"();



CREATE OR REPLACE TRIGGER "guard_phd_student_update_trg" BEFORE UPDATE ON "public"."phd_students" FOR EACH ROW EXECUTE FUNCTION "public"."guard_phd_student_update"();



CREATE OR REPLACE TRIGGER "guard_profile_update" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."guard_profile_update"();



CREATE OR REPLACE TRIGGER "guard_submission_provenance_trg" BEFORE INSERT OR UPDATE ON "public"."lab_submissions" FOR EACH ROW EXECUTE FUNCTION "public"."guard_submission_provenance"();



CREATE OR REPLACE TRIGGER "km_step_dirty" BEFORE UPDATE ON "public"."research_protocol_steps" FOR EACH ROW EXECUTE FUNCTION "public"."km_mark_dirty"();



CREATE OR REPLACE TRIGGER "phd_sync_primary_trg" AFTER INSERT OR UPDATE ON "public"."phd_supervisions" FOR EACH ROW EXECUTE FUNCTION "public"."phd_sync_primary"();



CREATE OR REPLACE TRIGGER "rm_touch" AFTER INSERT ON "public"."research_messages" FOR EACH ROW EXECUTE FUNCTION "public"."research_touch_chat"();



CREATE OR REPLACE TRIGGER "rp_guard_owner" BEFORE UPDATE ON "public"."research_projects" FOR EACH ROW EXECUTE FUNCTION "public"."research_guard_owner"();



CREATE OR REPLACE TRIGGER "rp_touch" BEFORE UPDATE ON "public"."research_projects" FOR EACH ROW EXECUTE FUNCTION "public"."research_touch_project"();



CREATE OR REPLACE TRIGGER "sub_code_trg" BEFORE INSERT ON "public"."submissions" FOR EACH ROW EXECUTE FUNCTION "public"."sub_assign_code"();



CREATE OR REPLACE TRIGGER "sub_touch_trg" BEFORE UPDATE ON "public"."submissions" FOR EACH ROW EXECUTE FUNCTION "public"."sub_touch"();



ALTER TABLE ONLY "public"."activity"
    ADD CONSTRAINT "activity_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."activity"
    ADD CONSTRAINT "activity_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_usage"
    ADD CONSTRAINT "ai_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."annotations"
    ADD CONSTRAINT "annotations_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."annotations"
    ADD CONSTRAINT "annotations_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."annotations"
    ADD CONSTRAINT "annotations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audiobooks"
    ADD CONSTRAINT "audiobooks_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audiobooks"
    ADD CONSTRAINT "audiobooks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bug_reports"
    ADD CONSTRAINT "bug_reports_replied_by_fkey" FOREIGN KEY ("replied_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bug_reports"
    ADD CONSTRAINT "bug_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."citation_paper_insights"
    ADD CONSTRAINT "citation_paper_insights_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."citation_paper_insights"
    ADD CONSTRAINT "citation_paper_insights_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."citation_reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."citation_paper_insights"
    ADD CONSTRAINT "citation_paper_insights_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."research_sources"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."citation_reports"
    ADD CONSTRAINT "citation_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_errors"
    ADD CONSTRAINT "client_errors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."compare_projects"
    ADD CONSTRAINT "compare_projects_owner_fkey" FOREIGN KEY ("owner") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_canvas_items"
    ADD CONSTRAINT "course_canvas_items_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_canvas_items"
    ADD CONSTRAINT "course_canvas_items_call_log_id_fkey" FOREIGN KEY ("call_log_id") REFERENCES "public"."mcp_call_log"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."course_canvas_items"
    ADD CONSTRAINT "course_canvas_items_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_canvas_items"
    ADD CONSTRAINT "course_canvas_items_lecture_id_fkey" FOREIGN KEY ("lecture_id") REFERENCES "public"."course_lectures"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."course_canvas_reactions"
    ADD CONSTRAINT "course_canvas_reactions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."course_canvas_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_canvas_reactions"
    ADD CONSTRAINT "course_canvas_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_credit_budgets"
    ADD CONSTRAINT "course_credit_budgets_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_credit_budgets"
    ADD CONSTRAINT "course_credit_budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_enrollments"
    ADD CONSTRAINT "course_enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_enrollments"
    ADD CONSTRAINT "course_enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_lectures"
    ADD CONSTRAINT "course_lectures_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_poll_votes"
    ADD CONSTRAINT "course_poll_votes_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."course_canvas_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_poll_votes"
    ADD CONSTRAINT "course_poll_votes_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "public"."course_polls"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_poll_votes"
    ADD CONSTRAINT "course_poll_votes_voter_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_polls"
    ADD CONSTRAINT "course_polls_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_polls"
    ADD CONSTRAINT "course_polls_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_polls"
    ADD CONSTRAINT "course_polls_lecture_id_fkey" FOREIGN KEY ("lecture_id") REFERENCES "public"."course_lectures"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."dm_messages"
    ADD CONSTRAINT "dm_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dm_messages"
    ADD CONSTRAINT "dm_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."dm_threads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dm_reads"
    ADD CONSTRAINT "dm_reads_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."dm_threads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dm_reads"
    ADD CONSTRAINT "dm_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dm_thread_members"
    ADD CONSTRAINT "dm_thread_members_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."dm_threads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dm_thread_members"
    ADD CONSTRAINT "dm_thread_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dm_threads"
    ADD CONSTRAINT "dm_threads_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."editorial_staff"
    ADD CONSTRAINT "editorial_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."elicit_jobs"
    ADD CONSTRAINT "elicit_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feature_usage"
    ADD CONSTRAINT "feature_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."km_edges"
    ADD CONSTRAINT "km_edges_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."km_edges"
    ADD CONSTRAINT "km_edges_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."km_edges"
    ADD CONSTRAINT "km_edges_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."km_nodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."km_edges"
    ADD CONSTRAINT "km_edges_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "public"."research_protocol_steps"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."km_edges"
    ADD CONSTRAINT "km_edges_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "public"."km_nodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."km_embeddings"
    ADD CONSTRAINT "km_embeddings_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "public"."km_nodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."km_embeddings"
    ADD CONSTRAINT "km_embeddings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."km_log"
    ADD CONSTRAINT "km_log_actor_fkey" FOREIGN KEY ("actor") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."km_log"
    ADD CONSTRAINT "km_log_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "public"."km_nodes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."km_log"
    ADD CONSTRAINT "km_log_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."km_nodes"
    ADD CONSTRAINT "km_nodes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."km_nodes"
    ADD CONSTRAINT "km_nodes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."km_nodes"
    ADD CONSTRAINT "km_nodes_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "public"."research_protocols"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."km_nodes"
    ADD CONSTRAINT "km_nodes_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "public"."research_protocol_steps"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lab_assignments"
    ADD CONSTRAINT "lab_assignments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lab_assignments"
    ADD CONSTRAINT "lab_assignments_lecture_id_fkey" FOREIGN KEY ("lecture_id") REFERENCES "public"."course_lectures"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lab_grades"
    ADD CONSTRAINT "lab_grades_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lab_grades"
    ADD CONSTRAINT "lab_grades_grader_id_fkey" FOREIGN KEY ("grader_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."lab_grades"
    ADD CONSTRAINT "lab_grades_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."lab_submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lab_submissions"
    ADD CONSTRAINT "lab_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."lab_assignments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lab_submissions"
    ADD CONSTRAINT "lab_submissions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lab_submissions"
    ADD CONSTRAINT "lab_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."letter_templates"
    ADD CONSTRAINT "letter_templates_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mcp_call_log"
    ADD CONSTRAINT "mcp_call_log_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."lab_assignments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mcp_call_log"
    ADD CONSTRAINT "mcp_call_log_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mcp_call_log"
    ADD CONSTRAINT "mcp_call_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."phd_degree_requirements"
    ADD CONSTRAINT "phd_degree_requirements_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."phd_students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."phd_milestones"
    ADD CONSTRAINT "phd_milestones_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."phd_students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."phd_students"
    ADD CONSTRAINT "phd_students_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."phd_students"
    ADD CONSTRAINT "phd_students_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."phd_supervisions"
    ADD CONSTRAINT "phd_supervisions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."phd_students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."phd_supervisions"
    ADD CONSTRAINT "phd_supervisions_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."phd_tasks"
    ADD CONSTRAINT "phd_tasks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."phd_students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."phd_topics"
    ADD CONSTRAINT "phd_topics_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."prefs"
    ADD CONSTRAINT "prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."publication_files"
    ADD CONSTRAINT "publication_files_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."publication_files"
    ADD CONSTRAINT "publication_files_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."publications"
    ADD CONSTRAINT "publications_researcher_id_fkey" FOREIGN KEY ("researcher_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reading_sessions"
    ADD CONSTRAINT "reading_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reading_sessions"
    ADD CONSTRAINT "reading_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_autopilot_events"
    ADD CONSTRAINT "research_autopilot_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_autopilot_events"
    ADD CONSTRAINT "research_autopilot_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."research_autopilot_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_autopilot_runs"
    ADD CONSTRAINT "research_autopilot_runs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_autopilot_runs"
    ADD CONSTRAINT "research_autopilot_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_canvas"
    ADD CONSTRAINT "research_canvas_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_canvas"
    ADD CONSTRAINT "research_canvas_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_chats"
    ADD CONSTRAINT "research_chats_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_chats"
    ADD CONSTRAINT "research_chats_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_datasets"
    ADD CONSTRAINT "research_datasets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_datasets"
    ADD CONSTRAINT "research_datasets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_draft_suggestions"
    ADD CONSTRAINT "research_draft_suggestions_author_fkey" FOREIGN KEY ("author") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_draft_suggestions"
    ADD CONSTRAINT "research_draft_suggestions_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "public"."research_drafts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_draft_suggestions"
    ADD CONSTRAINT "research_draft_suggestions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_draft_suggestions"
    ADD CONSTRAINT "research_draft_suggestions_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_drafts"
    ADD CONSTRAINT "research_drafts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_drafts"
    ADD CONSTRAINT "research_drafts_journal_pick_id_fkey" FOREIGN KEY ("journal_pick_id") REFERENCES "public"."research_journal_picks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_drafts"
    ADD CONSTRAINT "research_drafts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_evidence"
    ADD CONSTRAINT "research_evidence_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "public"."research_chats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_evidence"
    ADD CONSTRAINT "research_evidence_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."research_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_figures"
    ADD CONSTRAINT "research_figures_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_figures"
    ADD CONSTRAINT "research_figures_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."research_sources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_files"
    ADD CONSTRAINT "research_files_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "public"."research_chats"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_files"
    ADD CONSTRAINT "research_files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_gami_prefs"
    ADD CONSTRAINT "research_gami_prefs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_gami_prefs"
    ADD CONSTRAINT "research_gami_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_ideas"
    ADD CONSTRAINT "research_ideas_addressed_by_idea_id_fkey" FOREIGN KEY ("addressed_by_idea_id") REFERENCES "public"."research_ideas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_ideas"
    ADD CONSTRAINT "research_ideas_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_ideas"
    ADD CONSTRAINT "research_ideas_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_jobs"
    ADD CONSTRAINT "research_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_jobs"
    ADD CONSTRAINT "research_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_journal_picks"
    ADD CONSTRAINT "research_journal_picks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_journal_picks"
    ADD CONSTRAINT "research_journal_picks_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "public"."journals_ref"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_journal_picks"
    ADD CONSTRAINT "research_journal_picks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_log"
    ADD CONSTRAINT "research_log_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_log"
    ADD CONSTRAINT "research_log_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_map_comments"
    ADD CONSTRAINT "research_map_comments_author_fkey" FOREIGN KEY ("author") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_map_comments"
    ADD CONSTRAINT "research_map_comments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_map_edges"
    ADD CONSTRAINT "research_map_edges_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_map_frames"
    ADD CONSTRAINT "research_map_frames_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_map_frames"
    ADD CONSTRAINT "research_map_frames_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_map_layout"
    ADD CONSTRAINT "research_map_layout_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_map_layout"
    ADD CONSTRAINT "research_map_layout_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_map_objects"
    ADD CONSTRAINT "research_map_objects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_map_objects"
    ADD CONSTRAINT "research_map_objects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_map_pages"
    ADD CONSTRAINT "research_map_pages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_map_paths"
    ADD CONSTRAINT "research_map_paths_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_messages"
    ADD CONSTRAINT "research_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "public"."research_chats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_notes"
    ADD CONSTRAINT "research_notes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_notes"
    ADD CONSTRAINT "research_notes_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_project_members"
    ADD CONSTRAINT "research_project_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_project_members"
    ADD CONSTRAINT "research_project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_project_members"
    ADD CONSTRAINT "research_project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_projects"
    ADD CONSTRAINT "research_projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_projects"
    ADD CONSTRAINT "research_projects_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."phd_students"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_protocol_notes"
    ADD CONSTRAINT "research_protocol_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_protocol_notes"
    ADD CONSTRAINT "research_protocol_notes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_protocol_notes"
    ADD CONSTRAINT "research_protocol_notes_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "public"."research_protocols"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_protocol_notes"
    ADD CONSTRAINT "research_protocol_notes_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "public"."research_protocol_steps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_protocol_steps"
    ADD CONSTRAINT "research_protocol_steps_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_protocol_steps"
    ADD CONSTRAINT "research_protocol_steps_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "public"."research_protocols"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_protocol_steps"
    ADD CONSTRAINT "research_protocol_steps_signed_off_by_fkey" FOREIGN KEY ("signed_off_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_protocols"
    ADD CONSTRAINT "research_protocols_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_protocols"
    ADD CONSTRAINT "research_protocols_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "public"."research_ideas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_protocols"
    ADD CONSTRAINT "research_protocols_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_sources"
    ADD CONSTRAINT "research_sources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_sr_candidates"
    ADD CONSTRAINT "research_sr_candidates_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "public"."research_ideas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_sr_candidates"
    ADD CONSTRAINT "research_sr_candidates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_studies"
    ADD CONSTRAINT "research_studies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_studies"
    ADD CONSTRAINT "research_studies_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "public"."research_ideas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_studies"
    ADD CONSTRAINT "research_studies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_study_papers"
    ADD CONSTRAINT "research_study_papers_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."research_sources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_study_papers"
    ADD CONSTRAINT "research_study_papers_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "public"."research_studies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_study_steps"
    ADD CONSTRAINT "research_study_steps_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "public"."research_studies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_system_prompts"
    ADD CONSTRAINT "research_system_prompts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_tasks"
    ADD CONSTRAINT "research_tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_tasks"
    ADD CONSTRAINT "research_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_todos"
    ADD CONSTRAINT "research_todos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research_todos"
    ADD CONSTRAINT "research_todos_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_todos"
    ADD CONSTRAINT "research_todos_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."research_projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_daily_reports"
    ADD CONSTRAINT "student_daily_reports_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."phd_students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_daily_reports"
    ADD CONSTRAINT "student_daily_reports_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."submission_authors"
    ADD CONSTRAINT "submission_authors_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submission_authors"
    ADD CONSTRAINT "submission_authors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."submission_events"
    ADD CONSTRAINT "submission_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."submission_events"
    ADD CONSTRAINT "submission_events_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submission_letters"
    ADD CONSTRAINT "submission_letters_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."submission_letters"
    ADD CONSTRAINT "submission_letters_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."submission_letters"
    ADD CONSTRAINT "submission_letters_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submission_reviews"
    ADD CONSTRAINT "submission_reviews_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."submission_reviews"
    ADD CONSTRAINT "submission_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submission_reviews"
    ADD CONSTRAINT "submission_reviews_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submission_versions"
    ADD CONSTRAINT "submission_versions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submission_versions"
    ADD CONSTRAINT "submission_versions_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_handling_editor_id_fkey" FOREIGN KEY ("handling_editor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_journal_ref_id_fkey" FOREIGN KEY ("journal_ref_id") REFERENCES "public"."journals_ref"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usage_meters"
    ADD CONSTRAINT "usage_meters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_chat_files"
    ADD CONSTRAINT "user_chat_files_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "public"."user_chats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_chat_messages"
    ADD CONSTRAINT "user_chat_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "public"."user_chats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."versions"
    ADD CONSTRAINT "versions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."versions"
    ADD CONSTRAINT "versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



CREATE POLICY "ab_rw" ON "public"."audiobooks" TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



ALTER TABLE "public"."activity" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_all_profiles" ON "public"."profiles" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_all_projects" ON "public"."projects" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_read_members" ON "public"."project_members" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "admin_read_usage" ON "public"."usage_meters" FOR SELECT USING ("public"."is_admin"());



ALTER TABLE "public"."ai_usage" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_usage_own" ON "public"."ai_usage" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."allowed_models" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "allowed_models_admin" ON "public"."allowed_models" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "allowed_models_read" ON "public"."allowed_models" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."annotations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audiobooks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "br_insert" ON "public"."bug_reports" FOR INSERT WITH CHECK (("reporter_id" = "auth"."uid"()));



CREATE POLICY "br_read" ON "public"."bug_reports" FOR SELECT USING ((("reporter_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "br_update" ON "public"."bug_reports" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."bug_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ccb_read" ON "public"."course_credit_budgets" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."course_is_instructor"("course_id")));



CREATE POLICY "ccb_write" ON "public"."course_credit_budgets" TO "authenticated" USING ("public"."course_is_instructor"("course_id")) WITH CHECK ("public"."course_is_instructor"("course_id"));



CREATE POLICY "cci_delete" ON "public"."course_canvas_items" FOR DELETE TO "authenticated" USING ((("author_id" = "auth"."uid"()) OR "public"."course_is_instructor"("course_id")));



CREATE POLICY "cci_insert" ON "public"."course_canvas_items" FOR INSERT TO "authenticated" WITH CHECK ((("author_id" = "auth"."uid"()) AND "public"."course_is_member"("course_id")));



CREATE POLICY "cci_read" ON "public"."course_canvas_items" FOR SELECT TO "authenticated" USING (("public"."course_is_member"("course_id") AND ((NOT "hidden") OR ("author_id" = "auth"."uid"()) OR "public"."course_is_instructor"("course_id"))));



CREATE POLICY "cci_update" ON "public"."course_canvas_items" FOR UPDATE TO "authenticated" USING ((("author_id" = "auth"."uid"()) OR "public"."course_is_instructor"("course_id"))) WITH CHECK ((("author_id" = "auth"."uid"()) OR "public"."course_is_instructor"("course_id")));



CREATE POLICY "ccr_read" ON "public"."course_canvas_reactions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."course_canvas_items" "i"
  WHERE (("i"."id" = "course_canvas_reactions"."item_id") AND "public"."course_is_member"("i"."course_id")))));



CREATE POLICY "ccr_write" ON "public"."course_canvas_reactions" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."course_canvas_items" "i"
  WHERE (("i"."id" = "course_canvas_reactions"."item_id") AND "public"."course_is_member"("i"."course_id"))))));



CREATE POLICY "ce_insert_own" ON "public"."client_errors" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) OR ("user_id" IS NULL)));



CREATE POLICY "ce_read" ON "public"."course_enrollments" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."course_is_instructor"("course_id")));



CREATE POLICY "ce_read_admin" ON "public"."client_errors" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "ce_write" ON "public"."course_enrollments" TO "authenticated" USING ("public"."course_is_instructor"("course_id")) WITH CHECK ("public"."course_is_instructor"("course_id"));



CREATE POLICY "ci_read" ON "public"."citation_paper_insights" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "ci_write" ON "public"."citation_paper_insights" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



ALTER TABLE "public"."citation_paper_insights" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."citation_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cl_read" ON "public"."course_lectures" FOR SELECT TO "authenticated" USING (("public"."course_is_member"("course_id") AND ("visible" OR "public"."course_is_instructor"("course_id"))));



CREATE POLICY "cl_write" ON "public"."course_lectures" TO "authenticated" USING ("public"."course_is_instructor"("course_id")) WITH CHECK ("public"."course_is_instructor"("course_id"));



ALTER TABLE "public"."client_errors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."compare_projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_canvas_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_canvas_reactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_credit_budgets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_enrollments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_lectures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_poll_votes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_polls" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."courses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "courses_delete" ON "public"."courses" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "courses_insert" ON "public"."courses" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "courses_read" ON "public"."courses" FOR SELECT TO "authenticated" USING ("public"."course_is_member"("id"));



CREATE POLICY "courses_write" ON "public"."courses" FOR UPDATE TO "authenticated" USING ("public"."course_is_instructor"("id")) WITH CHECK ("public"."course_is_instructor"("id"));



CREATE POLICY "cp_del" ON "public"."compare_projects" FOR DELETE USING (("owner" = "auth"."uid"()));



CREATE POLICY "cp_ins" ON "public"."compare_projects" FOR INSERT WITH CHECK (("owner" = "auth"."uid"()));



CREATE POLICY "cp_read" ON "public"."course_polls" FOR SELECT TO "authenticated" USING ("public"."course_is_member"("course_id"));



CREATE POLICY "cp_sel" ON "public"."compare_projects" FOR SELECT USING (("owner" = "auth"."uid"()));



CREATE POLICY "cp_upd" ON "public"."compare_projects" FOR UPDATE USING (("owner" = "auth"."uid"())) WITH CHECK (("owner" = "auth"."uid"()));



CREATE POLICY "cp_write" ON "public"."course_polls" TO "authenticated" USING ("public"."course_is_instructor"("course_id")) WITH CHECK ("public"."course_is_instructor"("course_id"));



CREATE POLICY "cpv_read" ON "public"."course_poll_votes" FOR SELECT TO "authenticated" USING ((("voter_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."course_polls" "p"
  WHERE (("p"."id" = "course_poll_votes"."poll_id") AND "public"."course_is_instructor"("p"."course_id"))))));



CREATE POLICY "cr_read" ON "public"."citation_reports" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "cr_write" ON "public"."citation_reports" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "dm_m_read" ON "public"."dm_thread_members" FOR SELECT TO "authenticated" USING (("public"."dm_is_member"("thread_id") OR ("user_id" = "auth"."uid"())));



CREATE POLICY "dm_m_write" ON "public"."dm_thread_members" TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."dm_threads" "t"
  WHERE (("t"."id" = "dm_thread_members"."thread_id") AND ("t"."created_by" = "auth"."uid"())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."dm_threads" "t"
  WHERE (("t"."id" = "dm_thread_members"."thread_id") AND ("t"."created_by" = "auth"."uid"())))));



ALTER TABLE "public"."dm_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dm_msg_read" ON "public"."dm_messages" FOR SELECT TO "authenticated" USING ("public"."dm_is_member"("thread_id"));



CREATE POLICY "dm_msg_write" ON "public"."dm_messages" TO "authenticated" USING (("public"."dm_is_member"("thread_id") AND ("sender_id" = "auth"."uid"()))) WITH CHECK (("public"."dm_is_member"("thread_id") AND ("sender_id" = "auth"."uid"())));



ALTER TABLE "public"."dm_reads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dm_reads_rw" ON "public"."dm_reads" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "dm_t_read" ON "public"."dm_threads" FOR SELECT TO "authenticated" USING (("public"."dm_is_member"("id") OR ("created_by" = "auth"."uid"())));



CREATE POLICY "dm_t_write" ON "public"."dm_threads" TO "authenticated" USING ("public"."dm_is_member"("id")) WITH CHECK (("created_by" = "auth"."uid"()));



ALTER TABLE "public"."dm_thread_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dm_threads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."editorial_staff" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "elicit_cache_rw" ON "public"."elicit_search_cache" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."elicit_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "elicit_jobs_read" ON "public"."elicit_jobs" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"() OR (("project_id" IS NOT NULL) AND "public"."research_can_read_project"("project_id"))));



CREATE POLICY "elicit_jobs_write" ON "public"."elicit_jobs" TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"() OR (("project_id" IS NOT NULL) AND "public"."research_can_write_project"("project_id")))) WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_admin"() OR (("project_id" IS NOT NULL) AND "public"."research_can_write_project"("project_id"))));



ALTER TABLE "public"."elicit_mcp_org" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."elicit_mcp_pending" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."elicit_search_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "es_read" ON "public"."editorial_staff" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "es_write" ON "public"."editorial_staff" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."feature_catalog" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feature_catalog_admin" ON "public"."feature_catalog" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "feature_catalog_read" ON "public"."feature_catalog" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."feature_usage" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feature_usage_own" ON "public"."feature_usage" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."files" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gami_delete_own" ON "public"."research_gami_prefs" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "gami_insert_own" ON "public"."research_gami_prefs" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."research_can_read_project"("project_id")));



CREATE POLICY "gami_read" ON "public"."research_gami_prefs" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "gami_update_own" ON "public"."research_gami_prefs" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."research_can_read_project"("project_id")));



CREATE POLICY "insert_own_profile" ON "public"."profiles" FOR INSERT WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "insert_projects" ON "public"."projects" FOR INSERT WITH CHECK (("owner_id" = "auth"."uid"()));



ALTER TABLE "public"."journals_ref" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "journals_ref_read" ON "public"."journals_ref" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."km_edges" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "km_edges_read" ON "public"."km_edges" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "km_edges_write" ON "public"."km_edges" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK (("public"."research_can_write_project"("project_id") AND (EXISTS ( SELECT 1
   FROM "public"."km_nodes" "n"
  WHERE (("n"."id" = "km_edges"."source_id") AND ("n"."project_id" = "km_edges"."project_id")))) AND (EXISTS ( SELECT 1
   FROM "public"."km_nodes" "n"
  WHERE (("n"."id" = "km_edges"."target_id") AND ("n"."project_id" = "km_edges"."project_id"))))));



CREATE POLICY "km_emb_read" ON "public"."km_embeddings" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "km_emb_write" ON "public"."km_embeddings" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK (("public"."research_can_write_project"("project_id") AND (EXISTS ( SELECT 1
   FROM "public"."km_nodes" "n"
  WHERE (("n"."id" = "km_embeddings"."node_id") AND ("n"."project_id" = "km_embeddings"."project_id"))))));



ALTER TABLE "public"."km_embeddings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."km_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "km_log_read" ON "public"."km_log" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



ALTER TABLE "public"."km_nodes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "km_nodes_read" ON "public"."km_nodes" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "km_nodes_write" ON "public"."km_nodes" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "km_ont_read" ON "public"."km_ontology" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."km_ontology" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "la_read" ON "public"."lab_assignments" FOR SELECT TO "authenticated" USING (("public"."course_is_member"("course_id") AND ("visible" OR "public"."course_is_instructor"("course_id"))));



CREATE POLICY "la_write" ON "public"."lab_assignments" TO "authenticated" USING ("public"."course_is_instructor"("course_id")) WITH CHECK ("public"."course_is_instructor"("course_id"));



ALTER TABLE "public"."lab_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lab_grades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lab_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."letter_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lg_read" ON "public"."lab_grades" FOR SELECT TO "authenticated" USING (("public"."course_is_instructor"("course_id") OR (EXISTS ( SELECT 1
   FROM "public"."lab_submissions" "s"
  WHERE (("s"."id" = "lab_grades"."submission_id") AND ("s"."user_id" = "auth"."uid"()))))));



CREATE POLICY "lg_write" ON "public"."lab_grades" TO "authenticated" USING ("public"."course_is_instructor"("course_id")) WITH CHECK ("public"."course_is_instructor"("course_id"));



CREATE POLICY "ls_delete" ON "public"."lab_submissions" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."course_is_instructor"("course_id")));



CREATE POLICY "ls_insert" ON "public"."lab_submissions" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."course_is_member"("course_id") AND (("team" IS NULL) OR ("team" = ( SELECT "e2"."team"
   FROM "public"."course_enrollments" "e2"
  WHERE (("e2"."course_id" = "lab_submissions"."course_id") AND ("e2"."user_id" = "auth"."uid"()) AND ("e2"."status" = 'active'::"text")))))));



CREATE POLICY "ls_read" ON "public"."lab_submissions" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."course_is_instructor"("course_id") OR (("team" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."lab_assignments" "a"
  WHERE (("a"."id" = "lab_submissions"."assignment_id") AND "a"."team_based"))) AND (EXISTS ( SELECT 1
   FROM "public"."course_enrollments" "e"
  WHERE (("e"."course_id" = "lab_submissions"."course_id") AND ("e"."user_id" = "auth"."uid"()) AND ("e"."status" = 'active'::"text") AND ("e"."team" = "lab_submissions"."team")))))));



CREATE POLICY "ls_update" ON "public"."lab_submissions" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."course_is_instructor"("course_id"))) WITH CHECK (((("user_id" = "auth"."uid"()) AND (("team" IS NULL) OR ("team" = ( SELECT "e2"."team"
   FROM "public"."course_enrollments" "e2"
  WHERE (("e2"."course_id" = "lab_submissions"."course_id") AND ("e2"."user_id" = "auth"."uid"()) AND ("e2"."status" = 'active'::"text")))))) OR "public"."course_is_instructor"("course_id")));



CREATE POLICY "lt_select" ON "public"."letter_templates" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "lt_write" ON "public"."letter_templates" TO "authenticated" USING (("public"."is_editor"() OR "public"."is_admin"())) WITH CHECK (("public"."is_editor"() OR "public"."is_admin"()));



CREATE POLICY "manage_members" ON "public"."project_members" USING (("public"."role_on"("project_id") = 'owner'::"text")) WITH CHECK (("public"."role_on"("project_id") = 'owner'::"text"));



CREATE POLICY "mcl_read" ON "public"."mcp_call_log" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."course_is_instructor"("course_id")));



ALTER TABLE "public"."mcp_call_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "modify_annotations" ON "public"."annotations" FOR UPDATE USING ((("author_id" = "auth"."uid"()) OR ("public"."role_on"("project_id") = 'owner'::"text")));



CREATE POLICY "nf_delete" ON "public"."notifications" FOR DELETE TO "authenticated" USING ((("recipient_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "nf_insert" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK ((("recipient_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "nf_read" ON "public"."notifications" FOR SELECT TO "authenticated" USING ((("recipient_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "nf_update" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("recipient_id" = "auth"."uid"())) WITH CHECK (("recipient_id" = "auth"."uid"()));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "own_reading" ON "public"."reading_sessions" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "own_usage" ON "public"."usage_meters" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."phd_degree_requirements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "phd_dr_read" ON "public"."phd_degree_requirements" FOR SELECT TO "authenticated" USING ("public"."phd_can_read_student"("student_id"));



CREATE POLICY "phd_dr_write" ON "public"."phd_degree_requirements" TO "authenticated" USING ("public"."phd_can_write_student"("student_id")) WITH CHECK ("public"."phd_can_write_student"("student_id"));



ALTER TABLE "public"."phd_milestones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "phd_ms_read" ON "public"."phd_milestones" FOR SELECT TO "authenticated" USING ("public"."phd_can_read_student"("student_id"));



CREATE POLICY "phd_ms_write" ON "public"."phd_milestones" TO "authenticated" USING ("public"."phd_can_write_student"("student_id")) WITH CHECK ("public"."phd_can_write_student"("student_id"));



ALTER TABLE "public"."phd_students" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "phd_students_delete" ON "public"."phd_students" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR ("supervisor_id" = "auth"."uid"()) OR ("profile_id" = "auth"."uid"())));



CREATE POLICY "phd_students_insert" ON "public"."phd_students" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR ("profile_id" = "auth"."uid"())));



CREATE POLICY "phd_students_read" ON "public"."phd_students" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("profile_id" = "auth"."uid"()) OR ("supervisor_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."phd_supervisions" "v"
  WHERE (("v"."student_id" = "phd_students"."id") AND ("v"."supervisor_id" = "auth"."uid"()))))));



CREATE POLICY "phd_students_update" ON "public"."phd_students" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR ("supervisor_id" = "auth"."uid"()) OR ("profile_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."phd_supervisions" "v"
  WHERE (("v"."student_id" = "phd_students"."id") AND ("v"."supervisor_id" = "auth"."uid"()) AND ("v"."status" = 'accepted'::"text")))))) WITH CHECK (true);



ALTER TABLE "public"."phd_supervisions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "phd_sv_decide" ON "public"."phd_supervisions" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR ("supervisor_id" = "auth"."uid"()))) WITH CHECK (("public"."is_admin"() OR ("supervisor_id" = "auth"."uid"())));



CREATE POLICY "phd_sv_delete" ON "public"."phd_supervisions" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR ("supervisor_id" = "auth"."uid"()) OR "public"."phd_owns_student"("student_id")));



CREATE POLICY "phd_sv_read" ON "public"."phd_supervisions" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("supervisor_id" = "auth"."uid"()) OR "public"."phd_owns_student"("student_id")));



CREATE POLICY "phd_sv_request" ON "public"."phd_supervisions" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR ("public"."phd_owns_student"("student_id") AND ("status" = 'pending'::"text"))));



ALTER TABLE "public"."phd_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "phd_tasks_read" ON "public"."phd_tasks" FOR SELECT TO "authenticated" USING ("public"."phd_can_read_student"("student_id"));



CREATE POLICY "phd_tasks_write" ON "public"."phd_tasks" TO "authenticated" USING ("public"."phd_can_write_student"("student_id")) WITH CHECK ("public"."phd_can_write_student"("student_id"));



ALTER TABLE "public"."phd_topics" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "phd_topics_read" ON "public"."phd_topics" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "phd_topics_write" ON "public"."phd_topics" TO "authenticated" USING (("public"."is_admin"() OR ("supervisor_id" = "auth"."uid"()))) WITH CHECK (("public"."is_admin"() OR ("supervisor_id" = "auth"."uid"())));



ALTER TABLE "public"."plan_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prefs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prefs_owner" ON "public"."prefs" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pub_read" ON "public"."publications" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "pub_write" ON "public"."publications" TO "authenticated" USING ((("researcher_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("researcher_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "pubfile_owner" ON "public"."publication_files" TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("owner_id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."publication_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."publications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rae_delete" ON "public"."research_autopilot_events" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR "public"."research_can_write_project"("project_id")));



CREATE POLICY "rae_insert" ON "public"."research_autopilot_events" FOR INSERT TO "authenticated" WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rae_read" ON "public"."research_autopilot_events" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rar_delete" ON "public"."research_autopilot_runs" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR ("owner_id" = "auth"."uid"())));



CREATE POLICY "rar_insert" ON "public"."research_autopilot_runs" FOR INSERT TO "authenticated" WITH CHECK (("public"."research_can_write_project"("project_id") AND ("owner_id" = "auth"."uid"())));



CREATE POLICY "rar_read" ON "public"."research_autopilot_runs" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rar_update" ON "public"."research_autopilot_runs" FOR UPDATE TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rc_read" ON "public"."research_chats" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rc_write" ON "public"."research_chats" TO "authenticated" USING (("public"."research_can_write_project"("project_id") AND (("owner_id" = "auth"."uid"()) OR ("owner_id" IS NULL)))) WITH CHECK (("public"."research_can_write_project"("project_id") AND (("owner_id" = "auth"."uid"()) OR ("owner_id" IS NULL))));



CREATE POLICY "rcv_read" ON "public"."research_canvas" FOR SELECT USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rcv_write" ON "public"."research_canvas" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rd_read" ON "public"."research_datasets" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rd_write" ON "public"."research_datasets" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rdr_read" ON "public"."research_drafts" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rdr_write" ON "public"."research_drafts" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rds_delete" ON "public"."research_draft_suggestions" FOR DELETE TO "authenticated" USING ((("author" = "auth"."uid"()) OR "public"."research_can_write_project"("project_id")));



CREATE POLICY "rds_insert" ON "public"."research_draft_suggestions" FOR INSERT TO "authenticated" WITH CHECK (("public"."research_can_read_project"("project_id") AND ("author" = "auth"."uid"())));



CREATE POLICY "rds_read" ON "public"."research_draft_suggestions" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rds_update" ON "public"."research_draft_suggestions" FOR UPDATE TO "authenticated" USING ((("author" = "auth"."uid"()) OR "public"."research_can_write_project"("project_id"))) WITH CHECK ((("author" = "auth"."uid"()) OR "public"."research_can_write_project"("project_id")));



CREATE POLICY "re_read" ON "public"."research_evidence" FOR SELECT TO "authenticated" USING ("public"."research_can_read_chat"("chat_id"));



CREATE POLICY "re_write" ON "public"."research_evidence" TO "authenticated" USING ("public"."research_can_write_chat"("chat_id")) WITH CHECK ("public"."research_can_write_chat"("chat_id"));



CREATE POLICY "read_activity" ON "public"."activity" FOR SELECT USING (("public"."role_on"("project_id") IS NOT NULL));



CREATE POLICY "read_annotations" ON "public"."annotations" FOR SELECT USING (("public"."role_on"("project_id") IS NOT NULL));



CREATE POLICY "read_cache" ON "public"."tts_cache" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "read_files" ON "public"."files" FOR SELECT USING (("public"."role_on"("project_id") IS NOT NULL));



CREATE POLICY "read_members" ON "public"."project_members" FOR SELECT USING (("public"."role_on"("project_id") IS NOT NULL));



CREATE POLICY "read_own_profile" ON "public"."profiles" FOR SELECT USING (("id" = "auth"."uid"()));



CREATE POLICY "read_plan_limits" ON "public"."plan_limits" FOR SELECT USING (true);



CREATE POLICY "read_projects" ON "public"."projects" FOR SELECT USING (("public"."role_on"("id") IS NOT NULL));



CREATE POLICY "read_versions" ON "public"."versions" FOR SELECT USING (("public"."role_on"("project_id") IS NOT NULL));



ALTER TABLE "public"."reading_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_autopilot_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_autopilot_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_canvas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_chats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_datasets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_draft_suggestions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_drafts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_evidence" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_figures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_gami_prefs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_ideas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_journal_picks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_map_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_map_edges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_map_frames" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_map_layout" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_map_objects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_map_pages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_map_paths" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_project_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_protocol_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_protocol_steps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_protocols" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_sr_candidates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_studies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_study_papers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_study_steps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_system_prompts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_todos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rf_read" ON "public"."research_files" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rf_write" ON "public"."research_files" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rfig_read" ON "public"."research_figures" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rfig_write" ON "public"."research_figures" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "ri_read" ON "public"."research_ideas" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "ri_write" ON "public"."research_ideas" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rj_read" ON "public"."research_jobs" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rj_write" ON "public"."research_jobs" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rjp_read" ON "public"."research_journal_picks" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rjp_write" ON "public"."research_journal_picks" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rl_delete" ON "public"."research_log" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR ("profile_id" = "auth"."uid"())));



CREATE POLICY "rl_insert" ON "public"."research_log" FOR INSERT TO "authenticated" WITH CHECK (("public"."research_can_read_project"("project_id") AND ("profile_id" = "auth"."uid"())));



CREATE POLICY "rl_read" ON "public"."research_log" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rm_read" ON "public"."research_messages" FOR SELECT TO "authenticated" USING ("public"."research_can_read_chat"("chat_id"));



CREATE POLICY "rm_write" ON "public"."research_messages" TO "authenticated" USING ("public"."research_can_write_chat"("chat_id")) WITH CHECK ("public"."research_can_write_chat"("chat_id"));



CREATE POLICY "rmc_delete" ON "public"."research_map_comments" FOR DELETE TO "authenticated" USING ((("author" = "auth"."uid"()) OR "public"."research_can_write_project"("project_id")));



CREATE POLICY "rmc_insert" ON "public"."research_map_comments" FOR INSERT TO "authenticated" WITH CHECK (("public"."research_can_read_project"("project_id") AND ("author" = "auth"."uid"())));



CREATE POLICY "rmc_read" ON "public"."research_map_comments" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rmc_update" ON "public"."research_map_comments" FOR UPDATE TO "authenticated" USING ((("author" = "auth"."uid"()) OR "public"."research_can_write_project"("project_id"))) WITH CHECK ((("author" = "auth"."uid"()) OR "public"."research_can_write_project"("project_id")));



CREATE POLICY "rmedge_read" ON "public"."research_map_edges" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rmedge_write" ON "public"."research_map_edges" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rmf_read" ON "public"."research_map_frames" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rmf_write" ON "public"."research_map_frames" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rml_read" ON "public"."research_map_layout" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rml_write" ON "public"."research_map_layout" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rmo_read" ON "public"."research_map_objects" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rmo_write" ON "public"."research_map_objects" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rmp_read" ON "public"."research_map_pages" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rmp_write" ON "public"."research_map_pages" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rmpath_read" ON "public"."research_map_paths" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rmpath_write" ON "public"."research_map_paths" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rn_read" ON "public"."research_notes" FOR SELECT USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rn_write" ON "public"."research_notes" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rp_delete" ON "public"."research_projects" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR ("owner_id" = "auth"."uid"())));



CREATE POLICY "rp_insert" ON "public"."research_projects" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR ("owner_id" = "auth"."uid"())));



CREATE POLICY "rp_read" ON "public"."research_projects" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("owner_id" = "auth"."uid"()) OR "public"."research_supervises"("student_id") OR "public"."research_is_member"("id")));



CREATE POLICY "rp_update" ON "public"."research_projects" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR ("owner_id" = "auth"."uid"()) OR "public"."research_is_member"("id", ARRAY['owner'::"text", 'editor'::"text"]))) WITH CHECK (("public"."is_admin"() OR ("owner_id" = "auth"."uid"()) OR "public"."research_is_member"("id", ARRAY['owner'::"text", 'editor'::"text"])));



CREATE POLICY "rpm_delete" ON "public"."research_project_members" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."research_projects" "p"
  WHERE (("p"."id" = "research_project_members"."project_id") AND ("p"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "rpm_insert" ON "public"."research_project_members" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."research_projects" "p"
  WHERE (("p"."id" = "research_project_members"."project_id") AND ("p"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "rpm_read" ON "public"."research_project_members" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rpm_update" ON "public"."research_project_members" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."research_projects" "p"
  WHERE (("p"."id" = "research_project_members"."project_id") AND ("p"."owner_id" = "auth"."uid"())))))) WITH CHECK (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."research_projects" "p"
  WHERE (("p"."id" = "research_project_members"."project_id") AND ("p"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "rpn_delete" ON "public"."research_protocol_notes" FOR DELETE TO "authenticated" USING (("author_id" = "auth"."uid"()));



CREATE POLICY "rpn_insert" ON "public"."research_protocol_notes" FOR INSERT TO "authenticated" WITH CHECK (("public"."research_can_read_project"("project_id") AND ("author_id" = "auth"."uid"())));



CREATE POLICY "rpn_read" ON "public"."research_protocol_notes" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rprot_read" ON "public"."research_protocols" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rprot_write" ON "public"."research_protocols" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rpst_read" ON "public"."research_protocol_steps" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."research_protocols" "p"
  WHERE (("p"."id" = "research_protocol_steps"."protocol_id") AND "public"."research_can_read_project"("p"."project_id")))));



CREATE POLICY "rpst_write" ON "public"."research_protocol_steps" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."research_protocols" "p"
  WHERE (("p"."id" = "research_protocol_steps"."protocol_id") AND "public"."research_can_write_project"("p"."project_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."research_protocols" "p"
  WHERE (("p"."id" = "research_protocol_steps"."protocol_id") AND "public"."research_can_write_project"("p"."project_id")))));



CREATE POLICY "rs_read" ON "public"."research_sources" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rs_write" ON "public"."research_sources" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rsc_read" ON "public"."research_sr_candidates" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rsc_write" ON "public"."research_sr_candidates" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rsp_rw" ON "public"."research_system_prompts" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "rst_read" ON "public"."research_studies" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rst_write" ON "public"."research_studies" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rstp_read" ON "public"."research_study_papers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."research_studies" "s"
  WHERE (("s"."id" = "research_study_papers"."study_id") AND "public"."research_can_read_project"("s"."project_id")))));



CREATE POLICY "rstp_write" ON "public"."research_study_papers" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."research_studies" "s"
  WHERE (("s"."id" = "research_study_papers"."study_id") AND "public"."research_can_write_project"("s"."project_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."research_studies" "s"
  WHERE (("s"."id" = "research_study_papers"."study_id") AND "public"."research_can_write_project"("s"."project_id")))));



CREATE POLICY "rsts_read" ON "public"."research_study_steps" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."research_studies" "s"
  WHERE (("s"."id" = "research_study_steps"."study_id") AND "public"."research_can_read_project"("s"."project_id")))));



CREATE POLICY "rsts_write" ON "public"."research_study_steps" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."research_studies" "s"
  WHERE (("s"."id" = "research_study_steps"."study_id") AND "public"."research_can_write_project"("s"."project_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."research_studies" "s"
  WHERE (("s"."id" = "research_study_steps"."study_id") AND "public"."research_can_write_project"("s"."project_id")))));



CREATE POLICY "rt_read" ON "public"."research_tasks" FOR SELECT TO "authenticated" USING ("public"."research_can_read_project"("project_id"));



CREATE POLICY "rt_write" ON "public"."research_tasks" TO "authenticated" USING ("public"."research_can_write_project"("project_id")) WITH CHECK ("public"."research_can_write_project"("project_id"));



CREATE POLICY "rtd_delete" ON "public"."research_todos" FOR DELETE TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "rtd_insert" ON "public"."research_todos" FOR INSERT TO "authenticated" WITH CHECK ((("owner_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "rtd_read" ON "public"."research_todos" FOR SELECT TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR "public"."is_admin"() OR (("project_id" IS NOT NULL) AND "public"."research_can_read_project"("project_id"))));



CREATE POLICY "rtd_update" ON "public"."research_todos" FOR UPDATE TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("owner_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "sdr_read" ON "public"."student_daily_reports" FOR SELECT USING (("public"."is_admin"() OR "public"."research_supervises"("student_id")));



CREATE POLICY "sdr_write" ON "public"."student_daily_reports" USING (("public"."is_admin"() OR "public"."research_supervises"("student_id"))) WITH CHECK (("public"."is_admin"() OR "public"."research_supervises"("student_id")));



ALTER TABLE "public"."student_daily_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sub_delete" ON "public"."submissions" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR (("owner_id" = "auth"."uid"()) AND ("status" = 'draft'::"text"))));



CREATE POLICY "sub_insert" ON "public"."submissions" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "sub_select" ON "public"."submissions" FOR SELECT TO "authenticated" USING ("public"."sub_can_read"("id"));



CREATE POLICY "sub_update" ON "public"."submissions" FOR UPDATE TO "authenticated" USING (("public"."is_editor"() OR "public"."is_admin"() OR (("owner_id" = "auth"."uid"()) AND ("status" <> ALL (ARRAY['rejected'::"text", 'published'::"text", 'withdrawn'::"text"]))))) WITH CHECK (("public"."is_editor"() OR "public"."is_admin"() OR ("owner_id" = "auth"."uid"())));



CREATE POLICY "suba_select" ON "public"."submission_authors" FOR SELECT TO "authenticated" USING ("public"."sub_can_read"("submission_id"));



CREATE POLICY "suba_write" ON "public"."submission_authors" TO "authenticated" USING (("public"."is_editor"() OR "public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."submissions" "s"
  WHERE (("s"."id" = "submission_authors"."submission_id") AND ("s"."owner_id" = "auth"."uid"())))))) WITH CHECK (("public"."is_editor"() OR "public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."submissions" "s"
  WHERE (("s"."id" = "submission_authors"."submission_id") AND ("s"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "sube_insert" ON "public"."submission_events" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_editor"() OR "public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."submissions" "s"
  WHERE (("s"."id" = "submission_events"."submission_id") AND ("s"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "sube_select" ON "public"."submission_events" FOR SELECT TO "authenticated" USING (("public"."is_editor"() OR "public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."submissions" "s"
  WHERE (("s"."id" = "submission_events"."submission_id") AND ("s"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "subl_insert" ON "public"."submission_letters" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_editor"() OR "public"."is_admin"()));



CREATE POLICY "subl_select" ON "public"."submission_letters" FOR SELECT TO "authenticated" USING (("public"."is_editor"() OR "public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."submissions" "s"
  WHERE (("s"."id" = "submission_letters"."submission_id") AND ("s"."owner_id" = "auth"."uid"()))))));



ALTER TABLE "public"."submission_authors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."submission_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."submission_letters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."submission_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."submission_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."submissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subr_insert" ON "public"."submission_reviews" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_editor"() OR "public"."is_admin"()));



CREATE POLICY "subr_select" ON "public"."submission_reviews" FOR SELECT TO "authenticated" USING (("public"."is_editor"() OR "public"."is_admin"() OR ("reviewer_id" = "auth"."uid"())));



CREATE POLICY "subr_update" ON "public"."submission_reviews" FOR UPDATE TO "authenticated" USING (("public"."is_editor"() OR "public"."is_admin"() OR ("reviewer_id" = "auth"."uid"()))) WITH CHECK (("public"."is_editor"() OR "public"."is_admin"() OR ("reviewer_id" = "auth"."uid"())));



CREATE POLICY "subv_insert" ON "public"."submission_versions" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_editor"() OR "public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."submissions" "s"
  WHERE (("s"."id" = "submission_versions"."submission_id") AND ("s"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "subv_select" ON "public"."submission_versions" FOR SELECT TO "authenticated" USING ("public"."sub_can_read"("submission_id"));



ALTER TABLE "public"."tts_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "uc_owner" ON "public"."user_chats" TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "ucf_owner" ON "public"."user_chat_files" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_chats" "c"
  WHERE (("c"."id" = "user_chat_files"."chat_id") AND ("c"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_chats" "c"
  WHERE (("c"."id" = "user_chat_files"."chat_id") AND ("c"."owner_id" = "auth"."uid"())))));



CREATE POLICY "ucm_owner" ON "public"."user_chat_messages" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_chats" "c"
  WHERE (("c"."id" = "user_chat_messages"."chat_id") AND ("c"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_chats" "c"
  WHERE (("c"."id" = "user_chat_messages"."chat_id") AND ("c"."owner_id" = "auth"."uid"())))));



CREATE POLICY "update_projects" ON "public"."projects" FOR UPDATE USING (("public"."role_on"("id") = ANY (ARRAY['owner'::"text", 'editor'::"text"]))) WITH CHECK (("public"."role_on"("id") = ANY (ARRAY['owner'::"text", 'editor'::"text"])));



ALTER TABLE "public"."usage_meters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_chat_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_chat_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_chats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "write_activity" ON "public"."activity" FOR INSERT WITH CHECK ((("public"."role_on"("project_id") IS NOT NULL) AND ("actor_id" = "auth"."uid"())));



CREATE POLICY "write_annotations" ON "public"."annotations" FOR INSERT WITH CHECK (("public"."role_on"("project_id") = ANY (ARRAY['owner'::"text", 'editor'::"text", 'commenter'::"text"])));



CREATE POLICY "write_files" ON "public"."files" USING (("public"."role_on"("project_id") = ANY (ARRAY['owner'::"text", 'editor'::"text"]))) WITH CHECK (("public"."role_on"("project_id") = ANY (ARRAY['owner'::"text", 'editor'::"text"])));



CREATE POLICY "write_own_profile" ON "public"."profiles" FOR UPDATE USING (("id" = "auth"."uid"()));



CREATE POLICY "write_versions" ON "public"."versions" FOR INSERT WITH CHECK (("public"."role_on"("project_id") = ANY (ARRAY['owner'::"text", 'editor'::"text"])));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";



GRANT ALL ON FUNCTION "public"."ai_over_budget"("max_calls" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."ai_over_budget"("max_calls" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_over_budget"("max_calls" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."ai_usage_bump"() TO "anon";
GRANT ALL ON FUNCTION "public"."ai_usage_bump"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_usage_bump"() TO "service_role";



GRANT ALL ON FUNCTION "public"."build_research_digests"("for_day" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."build_research_digests"("for_day" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."build_research_digests"("for_day" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."canvas_author"("item" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."canvas_author"("item" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."canvas_author"("item" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cast_vote"("p_poll" "uuid", "p_item" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cast_vote"("p_poll" "uuid", "p_item" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cast_vote"("p_poll" "uuid", "p_item" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."charge_tts"("n" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."charge_tts"("n" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."charge_tts"("n" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."compare_shared"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compare_shared"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."compare_shared"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compare_shared"("p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."course_credit_debit"("p_course" "uuid", "p_service" "text", "p_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."course_credit_debit"("p_course" "uuid", "p_service" "text", "p_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."course_credit_debit"("p_course" "uuid", "p_service" "text", "p_amount" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."course_credit_refund"("p_course" "uuid", "p_user" "uuid", "p_service" "text", "p_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."course_credit_refund"("p_course" "uuid", "p_user" "uuid", "p_service" "text", "p_amount" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."course_is_instructor"("cid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."course_is_instructor"("cid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."course_is_instructor"("cid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."course_is_member"("cid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."course_is_member"("cid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."course_is_member"("cid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."course_join"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."course_join"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."course_join"("p_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."course_role"("cid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."course_role"("cid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."course_role"("cid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."distinct_journal_fields"() TO "anon";
GRANT ALL ON FUNCTION "public"."distinct_journal_fields"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."distinct_journal_fields"() TO "service_role";



GRANT ALL ON FUNCTION "public"."dm_is_member"("tid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."dm_is_member"("tid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dm_is_member"("tid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."dm_start_dm"("p_other" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."dm_start_dm"("p_other" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dm_start_dm"("p_other" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."dm_start_group"("p_name" "text", "p_members" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."dm_start_group"("p_name" "text", "p_members" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dm_start_group"("p_name" "text", "p_members" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."dm_touch_thread"() TO "anon";
GRANT ALL ON FUNCTION "public"."dm_touch_thread"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."dm_touch_thread"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."effective_model"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."effective_model"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."effective_model"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."elicit_mcp_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."elicit_mcp_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."elicit_mcp_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_model_allowlist"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_model_allowlist"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_model_allowlist"() TO "service_role";



GRANT ALL ON FUNCTION "public"."feature_over_budget"("p_key" "text", "max_calls" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."feature_over_budget"("p_key" "text", "max_calls" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."feature_over_budget"("p_key" "text", "max_calls" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."feature_usage_bump"("p_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."feature_usage_bump"("p_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."feature_usage_bump"("p_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_canvas_provenance"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_canvas_provenance"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_canvas_provenance"() TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_canvas_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_canvas_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_canvas_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_phd_student_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_phd_student_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_phd_student_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_profile_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_profile_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_profile_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_submission_provenance"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_submission_provenance"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_submission_provenance"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_active"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_active"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_active"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_editor"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_editor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_editor"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_feature_enabled"("p_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_feature_enabled"("p_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_feature_enabled"("p_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_feature_enabled_for"("p_uid" "uuid", "p_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_feature_enabled_for"("p_uid" "uuid", "p_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_feature_enabled_for"("p_uid" "uuid", "p_key" "text") TO "service_role";



GRANT ALL ON TABLE "public"."km_nodes" TO "anon";
GRANT ALL ON TABLE "public"."km_nodes" TO "authenticated";
GRANT ALL ON TABLE "public"."km_nodes" TO "service_role";



GRANT ALL ON FUNCTION "public"."km_hybrid_search"("query_text" "text", "query_embedding" "extensions"."vector", "match_count" integer, "fts_weight" real, "vec_weight" real, "rrf_k" integer, "filter_project" "uuid", "filter_kinds" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."km_hybrid_search"("query_text" "text", "query_embedding" "extensions"."vector", "match_count" integer, "fts_weight" real, "vec_weight" real, "rrf_k" integer, "filter_project" "uuid", "filter_kinds" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."km_hybrid_search"("query_text" "text", "query_embedding" "extensions"."vector", "match_count" integer, "fts_weight" real, "vec_weight" real, "rrf_k" integer, "filter_project" "uuid", "filter_kinds" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."km_mark_dirty"() TO "anon";
GRANT ALL ON FUNCTION "public"."km_mark_dirty"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."km_mark_dirty"() TO "service_role";



GRANT ALL ON FUNCTION "public"."km_subgraph"("root" "uuid", "max_hops" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."km_subgraph"("root" "uuid", "max_hops" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."km_subgraph"("root" "uuid", "max_hops" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."model_allowed"("p_model" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."model_allowed"("p_model" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."model_allowed"("p_model" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."note_cache_hit"("h" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."note_cache_hit"("h" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."note_cache_hit"("h" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."phd_can_read_student"("sid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."phd_can_read_student"("sid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."phd_can_read_student"("sid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."phd_can_write_student"("sid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."phd_can_write_student"("sid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."phd_can_write_student"("sid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."phd_owns_student"("sid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."phd_owns_student"("sid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."phd_owns_student"("sid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."phd_sync_primary"() TO "anon";
GRANT ALL ON FUNCTION "public"."phd_sync_primary"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."phd_sync_primary"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."poll_results"("p_poll" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."poll_results"("p_poll" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."poll_results"("p_poll" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."pr_accept_invitation"("p_project" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."pr_accept_invitation"("p_project" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pr_accept_invitation"("p_project" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pr_delete_annotation"("p_project" "uuid", "p_ann_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pr_delete_annotation"("p_project" "uuid", "p_ann_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."pr_delete_annotation"("p_project" "uuid", "p_ann_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pr_delete_annotation"("p_project" "uuid", "p_ann_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."pr_notify_dm"("p_recipient" "uuid", "p_thread" "uuid", "p_excerpt" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."pr_notify_dm"("p_recipient" "uuid", "p_thread" "uuid", "p_excerpt" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pr_notify_dm"("p_recipient" "uuid", "p_thread" "uuid", "p_excerpt" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."pr_notify_research_mention"("p_recipient" "uuid", "p_project" "uuid", "p_title" "text", "p_excerpt" "text", "p_node" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."pr_notify_research_mention"("p_recipient" "uuid", "p_project" "uuid", "p_title" "text", "p_excerpt" "text", "p_node" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pr_notify_research_mention"("p_recipient" "uuid", "p_project" "uuid", "p_title" "text", "p_excerpt" "text", "p_node" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."pr_notify_research_share"("p_recipient" "uuid", "p_project" "uuid", "p_title" "text", "p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."pr_notify_research_share"("p_recipient" "uuid", "p_project" "uuid", "p_title" "text", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pr_notify_research_share"("p_recipient" "uuid", "p_project" "uuid", "p_title" "text", "p_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."pr_notify_share"("p_recipient" "uuid", "p_project" "uuid", "p_title" "text", "p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."pr_notify_share"("p_recipient" "uuid", "p_project" "uuid", "p_title" "text", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pr_notify_share"("p_recipient" "uuid", "p_project" "uuid", "p_title" "text", "p_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."pr_notify_submission"("p_recipient" "uuid", "p_submission" "uuid", "p_kind" "text", "p_title" "text", "p_body" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."pr_notify_submission"("p_recipient" "uuid", "p_submission" "uuid", "p_kind" "text", "p_title" "text", "p_body" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pr_notify_submission"("p_recipient" "uuid", "p_submission" "uuid", "p_kind" "text", "p_title" "text", "p_body" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pr_save_annotations"("p_project" "uuid", "p_annotations" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pr_save_annotations"("p_project" "uuid", "p_annotations" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."pr_save_annotations"("p_project" "uuid", "p_annotations" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pr_save_annotations"("p_project" "uuid", "p_annotations" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pr_save_project"("p_id" "uuid", "p_owner" "uuid", "p_data" "jsonb", "p_title" "text", "p_deleted_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pr_save_project"("p_id" "uuid", "p_owner" "uuid", "p_data" "jsonb", "p_title" "text", "p_deleted_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."pr_save_project"("p_id" "uuid", "p_owner" "uuid", "p_data" "jsonb", "p_title" "text", "p_deleted_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."pr_save_project"("p_id" "uuid", "p_owner" "uuid", "p_data" "jsonb", "p_title" "text", "p_deleted_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."pr_search_users"("q" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."pr_search_users"("q" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pr_search_users"("q" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pr_upsert_annotation"("p_project" "uuid", "p_ann" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pr_upsert_annotation"("p_project" "uuid", "p_ann" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."pr_upsert_annotation"("p_project" "uuid", "p_ann" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pr_upsert_annotation"("p_project" "uuid", "p_ann" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."register_cache"("h" "text", "b" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."register_cache"("h" "text", "b" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_cache"("h" "text", "b" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."research_can_read_chat"("cid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."research_can_read_chat"("cid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_can_read_chat"("cid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."research_can_read_project"("pid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."research_can_read_project"("pid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_can_read_project"("pid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."research_can_write_chat"("cid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."research_can_write_chat"("cid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_can_write_chat"("cid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."research_can_write_project"("pid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."research_can_write_project"("pid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_can_write_project"("pid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."research_draft_set_section"("d_id" "uuid", "s_key" "text", "s_latex" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."research_draft_set_section"("d_id" "uuid", "s_key" "text", "s_latex" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_draft_set_section"("d_id" "uuid", "s_key" "text", "s_latex" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."research_gap_set_important"("gap_id" "uuid", "val" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."research_gap_set_important"("gap_id" "uuid", "val" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_gap_set_important"("gap_id" "uuid", "val" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."research_guard_owner"() TO "anon";
GRANT ALL ON FUNCTION "public"."research_guard_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_guard_owner"() TO "service_role";



GRANT ALL ON FUNCTION "public"."research_is_member"("pid" "uuid", "roles" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."research_is_member"("pid" "uuid", "roles" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_is_member"("pid" "uuid", "roles" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."research_is_supervisor"("pid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."research_is_supervisor"("pid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_is_supervisor"("pid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."research_member_accept"("pid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."research_member_accept"("pid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_member_accept"("pid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."research_step_signoff"("step_id" "uuid", "clear" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."research_step_signoff"("step_id" "uuid", "clear" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_step_signoff"("step_id" "uuid", "clear" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."research_supervises"("sid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."research_supervises"("sid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_supervises"("sid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."research_touch_chat"() TO "anon";
GRANT ALL ON FUNCTION "public"."research_touch_chat"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_touch_chat"() TO "service_role";



GRANT ALL ON FUNCTION "public"."research_touch_project"() TO "anon";
GRANT ALL ON FUNCTION "public"."research_touch_project"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."research_touch_project"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."retract_vote"("p_poll" "uuid", "p_item" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."retract_vote"("p_poll" "uuid", "p_item" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."retract_vote"("p_poll" "uuid", "p_item" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."role_on"("p" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."role_on"("p" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."role_on"("p" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rotate_join_code"("p_course" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rotate_join_code"("p_course" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rotate_join_code"("p_course" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."run_research_digests_yesterday"() TO "anon";
GRANT ALL ON FUNCTION "public"."run_research_digests_yesterday"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_research_digests_yesterday"() TO "service_role";



GRANT ALL ON FUNCTION "public"."safe_uuid"("t" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."safe_uuid"("t" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."safe_uuid"("t" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sub_assign_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."sub_assign_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sub_assign_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sub_can_read"("sid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sub_can_read"("sid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sub_can_read"("sid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sub_touch"() TO "anon";
GRANT ALL ON FUNCTION "public"."sub_touch"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sub_touch"() TO "service_role";



GRANT ALL ON TABLE "public"."activity" TO "anon";
GRANT ALL ON TABLE "public"."activity" TO "authenticated";
GRANT ALL ON TABLE "public"."activity" TO "service_role";



GRANT ALL ON TABLE "public"."ai_usage" TO "anon";
GRANT ALL ON TABLE "public"."ai_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_usage" TO "service_role";



GRANT ALL ON TABLE "public"."allowed_models" TO "anon";
GRANT ALL ON TABLE "public"."allowed_models" TO "authenticated";
GRANT ALL ON TABLE "public"."allowed_models" TO "service_role";



GRANT ALL ON TABLE "public"."annotations" TO "anon";
GRANT ALL ON TABLE "public"."annotations" TO "authenticated";
GRANT ALL ON TABLE "public"."annotations" TO "service_role";



GRANT ALL ON TABLE "public"."audiobooks" TO "anon";
GRANT ALL ON TABLE "public"."audiobooks" TO "authenticated";
GRANT ALL ON TABLE "public"."audiobooks" TO "service_role";



GRANT ALL ON TABLE "public"."bug_reports" TO "anon";
GRANT ALL ON TABLE "public"."bug_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."bug_reports" TO "service_role";



GRANT ALL ON TABLE "public"."citation_paper_insights" TO "anon";
GRANT ALL ON TABLE "public"."citation_paper_insights" TO "authenticated";
GRANT ALL ON TABLE "public"."citation_paper_insights" TO "service_role";



GRANT ALL ON TABLE "public"."citation_reports" TO "anon";
GRANT ALL ON TABLE "public"."citation_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."citation_reports" TO "service_role";



GRANT ALL ON TABLE "public"."client_errors" TO "anon";
GRANT ALL ON TABLE "public"."client_errors" TO "authenticated";
GRANT ALL ON TABLE "public"."client_errors" TO "service_role";



GRANT ALL ON TABLE "public"."compare_projects" TO "anon";
GRANT ALL ON TABLE "public"."compare_projects" TO "authenticated";
GRANT ALL ON TABLE "public"."compare_projects" TO "service_role";



GRANT ALL ON TABLE "public"."course_canvas_items" TO "anon";
GRANT ALL ON TABLE "public"."course_canvas_items" TO "authenticated";
GRANT ALL ON TABLE "public"."course_canvas_items" TO "service_role";



GRANT ALL ON TABLE "public"."course_canvas_reactions" TO "anon";
GRANT ALL ON TABLE "public"."course_canvas_reactions" TO "authenticated";
GRANT ALL ON TABLE "public"."course_canvas_reactions" TO "service_role";



GRANT ALL ON TABLE "public"."course_credit_budgets" TO "anon";
GRANT ALL ON TABLE "public"."course_credit_budgets" TO "authenticated";
GRANT ALL ON TABLE "public"."course_credit_budgets" TO "service_role";



GRANT ALL ON TABLE "public"."course_enrollments" TO "anon";
GRANT ALL ON TABLE "public"."course_enrollments" TO "authenticated";
GRANT ALL ON TABLE "public"."course_enrollments" TO "service_role";



GRANT ALL ON TABLE "public"."course_lectures" TO "anon";
GRANT ALL ON TABLE "public"."course_lectures" TO "authenticated";
GRANT ALL ON TABLE "public"."course_lectures" TO "service_role";



GRANT ALL ON TABLE "public"."course_poll_votes" TO "anon";
GRANT ALL ON TABLE "public"."course_poll_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."course_poll_votes" TO "service_role";



GRANT ALL ON TABLE "public"."course_polls" TO "anon";
GRANT ALL ON TABLE "public"."course_polls" TO "authenticated";
GRANT ALL ON TABLE "public"."course_polls" TO "service_role";



GRANT ALL ON TABLE "public"."courses" TO "anon";
GRANT ALL ON TABLE "public"."courses" TO "authenticated";
GRANT ALL ON TABLE "public"."courses" TO "service_role";



GRANT ALL ON TABLE "public"."dm_messages" TO "anon";
GRANT ALL ON TABLE "public"."dm_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."dm_messages" TO "service_role";



GRANT ALL ON TABLE "public"."dm_reads" TO "anon";
GRANT ALL ON TABLE "public"."dm_reads" TO "authenticated";
GRANT ALL ON TABLE "public"."dm_reads" TO "service_role";



GRANT ALL ON TABLE "public"."dm_thread_members" TO "anon";
GRANT ALL ON TABLE "public"."dm_thread_members" TO "authenticated";
GRANT ALL ON TABLE "public"."dm_thread_members" TO "service_role";



GRANT ALL ON TABLE "public"."dm_threads" TO "anon";
GRANT ALL ON TABLE "public"."dm_threads" TO "authenticated";
GRANT ALL ON TABLE "public"."dm_threads" TO "service_role";



GRANT ALL ON TABLE "public"."editorial_staff" TO "anon";
GRANT ALL ON TABLE "public"."editorial_staff" TO "authenticated";
GRANT ALL ON TABLE "public"."editorial_staff" TO "service_role";



GRANT ALL ON TABLE "public"."elicit_jobs" TO "anon";
GRANT ALL ON TABLE "public"."elicit_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."elicit_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."elicit_mcp_org" TO "anon";
GRANT ALL ON TABLE "public"."elicit_mcp_org" TO "authenticated";
GRANT ALL ON TABLE "public"."elicit_mcp_org" TO "service_role";



GRANT ALL ON TABLE "public"."elicit_mcp_pending" TO "anon";
GRANT ALL ON TABLE "public"."elicit_mcp_pending" TO "authenticated";
GRANT ALL ON TABLE "public"."elicit_mcp_pending" TO "service_role";



GRANT ALL ON TABLE "public"."elicit_search_cache" TO "anon";
GRANT ALL ON TABLE "public"."elicit_search_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."elicit_search_cache" TO "service_role";



GRANT ALL ON TABLE "public"."feature_catalog" TO "anon";
GRANT ALL ON TABLE "public"."feature_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."feature_catalog" TO "service_role";



GRANT ALL ON TABLE "public"."feature_usage" TO "anon";
GRANT ALL ON TABLE "public"."feature_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."feature_usage" TO "service_role";



GRANT ALL ON TABLE "public"."files" TO "anon";
GRANT ALL ON TABLE "public"."files" TO "authenticated";
GRANT ALL ON TABLE "public"."files" TO "service_role";



GRANT ALL ON TABLE "public"."journals_ref" TO "anon";
GRANT ALL ON TABLE "public"."journals_ref" TO "authenticated";
GRANT ALL ON TABLE "public"."journals_ref" TO "service_role";



GRANT ALL ON TABLE "public"."km_edges" TO "anon";
GRANT ALL ON TABLE "public"."km_edges" TO "authenticated";
GRANT ALL ON TABLE "public"."km_edges" TO "service_role";



GRANT ALL ON TABLE "public"."km_embeddings" TO "anon";
GRANT ALL ON TABLE "public"."km_embeddings" TO "authenticated";
GRANT ALL ON TABLE "public"."km_embeddings" TO "service_role";



GRANT ALL ON TABLE "public"."km_log" TO "anon";
GRANT ALL ON TABLE "public"."km_log" TO "authenticated";
GRANT ALL ON TABLE "public"."km_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."km_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."km_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."km_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."km_ontology" TO "anon";
GRANT ALL ON TABLE "public"."km_ontology" TO "authenticated";
GRANT ALL ON TABLE "public"."km_ontology" TO "service_role";



GRANT ALL ON SEQUENCE "public"."km_ontology_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."km_ontology_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."km_ontology_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."lab_assignments" TO "anon";
GRANT ALL ON TABLE "public"."lab_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."lab_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."lab_grades" TO "anon";
GRANT ALL ON TABLE "public"."lab_grades" TO "authenticated";
GRANT ALL ON TABLE "public"."lab_grades" TO "service_role";



GRANT ALL ON TABLE "public"."lab_submissions" TO "anon";
GRANT ALL ON TABLE "public"."lab_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."lab_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."letter_templates" TO "anon";
GRANT ALL ON TABLE "public"."letter_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."letter_templates" TO "service_role";



GRANT ALL ON TABLE "public"."mcp_call_log" TO "anon";
GRANT ALL ON TABLE "public"."mcp_call_log" TO "authenticated";
GRANT ALL ON TABLE "public"."mcp_call_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."mcp_call_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."mcp_call_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."mcp_call_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."phd_degree_requirements" TO "anon";
GRANT ALL ON TABLE "public"."phd_degree_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."phd_degree_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."phd_milestones" TO "anon";
GRANT ALL ON TABLE "public"."phd_milestones" TO "authenticated";
GRANT ALL ON TABLE "public"."phd_milestones" TO "service_role";



GRANT ALL ON TABLE "public"."phd_students" TO "anon";
GRANT ALL ON TABLE "public"."phd_students" TO "authenticated";
GRANT ALL ON TABLE "public"."phd_students" TO "service_role";



GRANT ALL ON TABLE "public"."phd_supervisions" TO "anon";
GRANT ALL ON TABLE "public"."phd_supervisions" TO "authenticated";
GRANT ALL ON TABLE "public"."phd_supervisions" TO "service_role";



GRANT ALL ON TABLE "public"."phd_tasks" TO "anon";
GRANT ALL ON TABLE "public"."phd_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."phd_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."phd_topics" TO "anon";
GRANT ALL ON TABLE "public"."phd_topics" TO "authenticated";
GRANT ALL ON TABLE "public"."phd_topics" TO "service_role";



GRANT ALL ON TABLE "public"."plan_limits" TO "anon";
GRANT ALL ON TABLE "public"."plan_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."plan_limits" TO "service_role";



GRANT ALL ON TABLE "public"."prefs" TO "anon";
GRANT ALL ON TABLE "public"."prefs" TO "authenticated";
GRANT ALL ON TABLE "public"."prefs" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."profiles" TO "supabase_auth_admin";



GRANT ALL ON TABLE "public"."profiles_public" TO "anon";
GRANT ALL ON TABLE "public"."profiles_public" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles_public" TO "service_role";



GRANT ALL ON TABLE "public"."project_members" TO "anon";
GRANT ALL ON TABLE "public"."project_members" TO "authenticated";
GRANT ALL ON TABLE "public"."project_members" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."publication_files" TO "anon";
GRANT ALL ON TABLE "public"."publication_files" TO "authenticated";
GRANT ALL ON TABLE "public"."publication_files" TO "service_role";



GRANT ALL ON TABLE "public"."publications" TO "anon";
GRANT ALL ON TABLE "public"."publications" TO "authenticated";
GRANT ALL ON TABLE "public"."publications" TO "service_role";



GRANT ALL ON TABLE "public"."reading_sessions" TO "anon";
GRANT ALL ON TABLE "public"."reading_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."reading_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."research_autopilot_events" TO "anon";
GRANT ALL ON TABLE "public"."research_autopilot_events" TO "authenticated";
GRANT ALL ON TABLE "public"."research_autopilot_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."research_autopilot_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."research_autopilot_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."research_autopilot_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."research_autopilot_runs" TO "anon";
GRANT ALL ON TABLE "public"."research_autopilot_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."research_autopilot_runs" TO "service_role";



GRANT ALL ON TABLE "public"."research_canvas" TO "anon";
GRANT ALL ON TABLE "public"."research_canvas" TO "authenticated";
GRANT ALL ON TABLE "public"."research_canvas" TO "service_role";



GRANT ALL ON TABLE "public"."research_chats" TO "anon";
GRANT ALL ON TABLE "public"."research_chats" TO "authenticated";
GRANT ALL ON TABLE "public"."research_chats" TO "service_role";



GRANT ALL ON TABLE "public"."research_datasets" TO "anon";
GRANT ALL ON TABLE "public"."research_datasets" TO "authenticated";
GRANT ALL ON TABLE "public"."research_datasets" TO "service_role";



GRANT ALL ON TABLE "public"."research_draft_suggestions" TO "anon";
GRANT ALL ON TABLE "public"."research_draft_suggestions" TO "authenticated";
GRANT ALL ON TABLE "public"."research_draft_suggestions" TO "service_role";



GRANT ALL ON TABLE "public"."research_drafts" TO "anon";
GRANT ALL ON TABLE "public"."research_drafts" TO "authenticated";
GRANT ALL ON TABLE "public"."research_drafts" TO "service_role";



GRANT ALL ON TABLE "public"."research_evidence" TO "anon";
GRANT ALL ON TABLE "public"."research_evidence" TO "authenticated";
GRANT ALL ON TABLE "public"."research_evidence" TO "service_role";



GRANT ALL ON TABLE "public"."research_figures" TO "anon";
GRANT ALL ON TABLE "public"."research_figures" TO "authenticated";
GRANT ALL ON TABLE "public"."research_figures" TO "service_role";



GRANT ALL ON TABLE "public"."research_files" TO "anon";
GRANT ALL ON TABLE "public"."research_files" TO "authenticated";
GRANT ALL ON TABLE "public"."research_files" TO "service_role";



GRANT ALL ON TABLE "public"."research_gami_prefs" TO "anon";
GRANT ALL ON TABLE "public"."research_gami_prefs" TO "authenticated";
GRANT ALL ON TABLE "public"."research_gami_prefs" TO "service_role";



GRANT ALL ON TABLE "public"."research_ideas" TO "anon";
GRANT ALL ON TABLE "public"."research_ideas" TO "authenticated";
GRANT ALL ON TABLE "public"."research_ideas" TO "service_role";



GRANT ALL ON TABLE "public"."research_jobs" TO "anon";
GRANT ALL ON TABLE "public"."research_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."research_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."research_journal_picks" TO "anon";
GRANT ALL ON TABLE "public"."research_journal_picks" TO "authenticated";
GRANT ALL ON TABLE "public"."research_journal_picks" TO "service_role";



GRANT ALL ON TABLE "public"."research_log" TO "anon";
GRANT ALL ON TABLE "public"."research_log" TO "authenticated";
GRANT ALL ON TABLE "public"."research_log" TO "service_role";



GRANT ALL ON TABLE "public"."research_map_comments" TO "anon";
GRANT ALL ON TABLE "public"."research_map_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."research_map_comments" TO "service_role";



GRANT ALL ON TABLE "public"."research_map_edges" TO "anon";
GRANT ALL ON TABLE "public"."research_map_edges" TO "authenticated";
GRANT ALL ON TABLE "public"."research_map_edges" TO "service_role";



GRANT ALL ON TABLE "public"."research_map_frames" TO "anon";
GRANT ALL ON TABLE "public"."research_map_frames" TO "authenticated";
GRANT ALL ON TABLE "public"."research_map_frames" TO "service_role";



GRANT ALL ON TABLE "public"."research_map_layout" TO "anon";
GRANT ALL ON TABLE "public"."research_map_layout" TO "authenticated";
GRANT ALL ON TABLE "public"."research_map_layout" TO "service_role";



GRANT ALL ON TABLE "public"."research_map_objects" TO "anon";
GRANT ALL ON TABLE "public"."research_map_objects" TO "authenticated";
GRANT ALL ON TABLE "public"."research_map_objects" TO "service_role";



GRANT ALL ON TABLE "public"."research_map_pages" TO "anon";
GRANT ALL ON TABLE "public"."research_map_pages" TO "authenticated";
GRANT ALL ON TABLE "public"."research_map_pages" TO "service_role";



GRANT ALL ON TABLE "public"."research_map_paths" TO "anon";
GRANT ALL ON TABLE "public"."research_map_paths" TO "authenticated";
GRANT ALL ON TABLE "public"."research_map_paths" TO "service_role";



GRANT ALL ON TABLE "public"."research_messages" TO "anon";
GRANT ALL ON TABLE "public"."research_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."research_messages" TO "service_role";



GRANT ALL ON TABLE "public"."research_notes" TO "anon";
GRANT ALL ON TABLE "public"."research_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."research_notes" TO "service_role";



GRANT ALL ON TABLE "public"."research_project_members" TO "anon";
GRANT ALL ON TABLE "public"."research_project_members" TO "authenticated";
GRANT ALL ON TABLE "public"."research_project_members" TO "service_role";



GRANT ALL ON TABLE "public"."research_projects" TO "anon";
GRANT ALL ON TABLE "public"."research_projects" TO "authenticated";
GRANT ALL ON TABLE "public"."research_projects" TO "service_role";



GRANT ALL ON TABLE "public"."research_protocol_notes" TO "anon";
GRANT ALL ON TABLE "public"."research_protocol_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."research_protocol_notes" TO "service_role";



GRANT ALL ON TABLE "public"."research_protocol_steps" TO "anon";
GRANT ALL ON TABLE "public"."research_protocol_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."research_protocol_steps" TO "service_role";



GRANT ALL ON TABLE "public"."research_protocols" TO "anon";
GRANT ALL ON TABLE "public"."research_protocols" TO "authenticated";
GRANT ALL ON TABLE "public"."research_protocols" TO "service_role";



GRANT ALL ON TABLE "public"."research_sources" TO "anon";
GRANT ALL ON TABLE "public"."research_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."research_sources" TO "service_role";



GRANT ALL ON TABLE "public"."research_sr_candidates" TO "anon";
GRANT ALL ON TABLE "public"."research_sr_candidates" TO "authenticated";
GRANT ALL ON TABLE "public"."research_sr_candidates" TO "service_role";



GRANT ALL ON TABLE "public"."research_studies" TO "anon";
GRANT ALL ON TABLE "public"."research_studies" TO "authenticated";
GRANT ALL ON TABLE "public"."research_studies" TO "service_role";



GRANT ALL ON TABLE "public"."research_study_papers" TO "anon";
GRANT ALL ON TABLE "public"."research_study_papers" TO "authenticated";
GRANT ALL ON TABLE "public"."research_study_papers" TO "service_role";



GRANT ALL ON TABLE "public"."research_study_steps" TO "anon";
GRANT ALL ON TABLE "public"."research_study_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."research_study_steps" TO "service_role";



GRANT ALL ON TABLE "public"."research_system_prompts" TO "anon";
GRANT ALL ON TABLE "public"."research_system_prompts" TO "authenticated";
GRANT ALL ON TABLE "public"."research_system_prompts" TO "service_role";



GRANT ALL ON TABLE "public"."research_tasks" TO "anon";
GRANT ALL ON TABLE "public"."research_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."research_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."research_todos" TO "anon";
GRANT ALL ON TABLE "public"."research_todos" TO "authenticated";
GRANT ALL ON TABLE "public"."research_todos" TO "service_role";



GRANT ALL ON TABLE "public"."student_daily_reports" TO "anon";
GRANT ALL ON TABLE "public"."student_daily_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."student_daily_reports" TO "service_role";



GRANT ALL ON TABLE "public"."submission_authors" TO "anon";
GRANT ALL ON TABLE "public"."submission_authors" TO "authenticated";
GRANT ALL ON TABLE "public"."submission_authors" TO "service_role";



GRANT ALL ON SEQUENCE "public"."submission_code_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."submission_code_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."submission_code_seq" TO "service_role";



GRANT ALL ON TABLE "public"."submission_events" TO "anon";
GRANT ALL ON TABLE "public"."submission_events" TO "authenticated";
GRANT ALL ON TABLE "public"."submission_events" TO "service_role";



GRANT ALL ON TABLE "public"."submission_letters" TO "anon";
GRANT ALL ON TABLE "public"."submission_letters" TO "authenticated";
GRANT ALL ON TABLE "public"."submission_letters" TO "service_role";



GRANT ALL ON TABLE "public"."submission_reviews" TO "anon";
GRANT ALL ON TABLE "public"."submission_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."submission_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."submission_versions" TO "anon";
GRANT ALL ON TABLE "public"."submission_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."submission_versions" TO "service_role";



GRANT ALL ON TABLE "public"."submissions" TO "anon";
GRANT ALL ON TABLE "public"."submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."submissions" TO "service_role";



GRANT ALL ON TABLE "public"."supervisors_public" TO "anon";
GRANT ALL ON TABLE "public"."supervisors_public" TO "authenticated";
GRANT ALL ON TABLE "public"."supervisors_public" TO "service_role";



GRANT ALL ON TABLE "public"."tts_cache" TO "anon";
GRANT ALL ON TABLE "public"."tts_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."tts_cache" TO "service_role";



GRANT ALL ON TABLE "public"."usage_meters" TO "anon";
GRANT ALL ON TABLE "public"."usage_meters" TO "authenticated";
GRANT ALL ON TABLE "public"."usage_meters" TO "service_role";



GRANT ALL ON TABLE "public"."user_chat_files" TO "anon";
GRANT ALL ON TABLE "public"."user_chat_files" TO "authenticated";
GRANT ALL ON TABLE "public"."user_chat_files" TO "service_role";



GRANT ALL ON TABLE "public"."user_chat_messages" TO "anon";
GRANT ALL ON TABLE "public"."user_chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."user_chat_messages" TO "service_role";



GRANT ALL ON TABLE "public"."user_chats" TO "anon";
GRANT ALL ON TABLE "public"."user_chats" TO "authenticated";
GRANT ALL ON TABLE "public"."user_chats" TO "service_role";



GRANT ALL ON TABLE "public"."versions" TO "anon";
GRANT ALL ON TABLE "public"."versions" TO "authenticated";
GRANT ALL ON TABLE "public"."versions" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







