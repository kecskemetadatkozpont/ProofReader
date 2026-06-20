-- ============================================================================
--  Publify — migration 10: make "is a student" mean "has a phd_students record".
--  The admin's Student toggle / self-register create the actual record; this keeps
--  one record per user and clears stale is_student flags that have no record
--  (so the Students list and the flag stay consistent). Run in the SQL editor.
-- ============================================================================

-- one student record per linked account
create unique index if not exists phd_students_profile_uniq on phd_students(profile_id) where profile_id is not null;

-- the seeded researchers are supervisors; restore any that got toggled off (the directory
-- dropped because is_supervisor was turned off). A researcher can also be a student — that's
-- a separate flag — but they belong in the supervisor directory.
update profiles set is_supervisor = true where is_researcher = true and is_supervisor = false;

-- clear is_student flags that never produced a record (e.g. exploratory admin toggles),
-- so the flag matches reality. Self-registered / linked students (with a record) are kept.
update profiles set is_student = false
 where is_student = true
   and not exists (select 1 from phd_students s where s.profile_id = profiles.id);
