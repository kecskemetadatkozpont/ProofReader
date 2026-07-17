-- ============================================================================
--  Publify — migration 78: atomic single-section draft write (cooperative Phase 5 fix)
--
--  research_drafts.sections is one jsonb array. Writing the WHOLE array back for a
--  single-section change is a whole-row last-write-wins: a concurrent editor (or a
--  just-accepted suggestion) on a DIFFERENT section can be silently reverted by a stale
--  local copy. This RPC updates ONLY the target section, under a row lock (select ...
--  for update), so concurrent single-section writes serialize and never clobber each
--  other. Authorization = admin or project writer (same as the drafts UPDATE RLS).
--
--  research_draft_set_section(d_id, s_key, s_latex) — sets sections[key==s_key].latex.
--  Graceful: the client probes it and falls back to the whole-array write pre-migration.
--  Idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

create or replace function public.research_draft_set_section(d_id uuid, s_key text, s_latex text) returns void
language plpgsql security definer set search_path = public as $$
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
