-- ============================================================================
--  Publify — migration 09: a supervisor can read a student's basic record for a
--  PENDING request too (so the "Requests" inbox can show the name + topic before
--  the supervisor accepts). Detailed KPIs (milestones/etc.) still require an
--  ACCEPTED supervision via phd_can_read_student — unchanged. Run in the SQL editor.
-- ============================================================================

drop policy if exists phd_students_read on phd_students;
create policy phd_students_read on phd_students for select to authenticated
  using (
    is_admin() or profile_id = auth.uid() or supervisor_id = auth.uid()
    or exists (select 1 from phd_supervisions v where v.student_id = phd_students.id and v.supervisor_id = auth.uid())
  );
