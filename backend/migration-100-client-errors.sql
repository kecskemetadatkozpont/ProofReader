-- ============================================================================
--  Publify — migration 100: production client-side error logging (observability).
--
--  MVP-hardening: today a JS error in the browser is INVISIBLE to the team. This
--  table captures uncaught errors + unhandled promise rejections (nav.js global
--  handlers) so admins can see what breaks in production. Fire-and-forget from
--  the client, deduped + capped per page-load so it can't flood.
--
--  RLS: any authenticated user may INSERT their OWN error row (user_id = auth.uid()
--  or NULL when the session user isn't resolved). Only admins may READ (is_admin()).
--  No update/delete for anyone (append-only log; prune via a scheduled job later).
--
--  Idempotent; run in the SQL editor. Requires migration-04 (is_admin()).
-- ============================================================================

create table if not exists public.client_errors (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  page        text,
  message     text not null,
  stack       text,
  kind        text default 'error',   -- 'error' | 'unhandledrejection' | 'manual'
  user_agent  text,
  app_build   text,
  created_at  timestamptz not null default now()
);

create index if not exists client_errors_created_idx on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;

-- INSERT: authenticated users log their own (or an unattributed) error row.
drop policy if exists ce_insert_own on public.client_errors;
create policy ce_insert_own on public.client_errors for insert to authenticated
  with check (user_id = auth.uid() or user_id is null);

-- READ: admins only.
drop policy if exists ce_read_admin on public.client_errors;
create policy ce_read_admin on public.client_errors for select to authenticated
  using (public.is_admin());

grant insert, select on public.client_errors to authenticated;
