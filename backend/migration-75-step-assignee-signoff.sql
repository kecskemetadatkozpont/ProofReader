-- ============================================================================
--  Publify — migration 75: protocol-step assignee + sign-off (cooperative Phase 2)
--
--  Adds who is RESPONSIBLE for a protocol step and a SIGN-OFF record (a collaborator
--  marks the step as reviewed/approved). Extends the existing needs_approval gate with a
--  human sign-off trail. No RLS change: research_protocol_steps is already gated via its
--  protocol → project (a step is writable by project editors). Sign-off is therefore an
--  editor/owner action in the app (a read-only supervisor cannot write — future work).
--
--  Graceful: the Map probes these columns; absent (pre-migration) → no assignee/sign-off UI.
--  Idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

alter table research_protocol_steps add column if not exists assignee_id   uuid references profiles(id) on delete set null;
alter table research_protocol_steps add column if not exists signed_off_by uuid references profiles(id) on delete set null;
alter table research_protocol_steps add column if not exists signed_off_at timestamptz;

comment on column research_protocol_steps.assignee_id  is 'Who is responsible for this step (a project member).';
comment on column research_protocol_steps.signed_off_by is 'Who signed off / approved this step (null = not signed off).';
