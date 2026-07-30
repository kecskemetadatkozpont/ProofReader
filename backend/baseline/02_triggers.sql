-- Trigger bindings — extracted from backend/migration-*.sql (the dump omits CREATE TRIGGER).
-- Idempotent: each create is preceded by a matching DROP TRIGGER IF EXISTS.

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

drop trigger if exists guard_profile_update on profiles;
create trigger guard_profile_update before update on profiles for each row execute function public.guard_profile_update();

drop trigger if exists phd_sync_primary_trg on phd_supervisions;
create trigger phd_sync_primary_trg after insert or update on phd_supervisions for each row execute function public.phd_sync_primary();

drop trigger if exists guard_phd_student_update_trg on phd_students;
create trigger guard_phd_student_update_trg before update on phd_students for each row execute function public.guard_phd_student_update();

drop trigger if exists rp_touch on research_projects;
create trigger rp_touch before update on research_projects for each row execute function public.research_touch_project();

drop trigger if exists rm_touch on research_messages;
create trigger rm_touch after insert on research_messages for each row execute function public.research_touch_chat();

drop trigger if exists sub_code_trg on submissions;
create trigger sub_code_trg before insert on submissions for each row execute function public.sub_assign_code();

drop trigger if exists sub_touch_trg on submissions;
create trigger sub_touch_trg before update on submissions for each row execute function public.sub_touch();

drop trigger if exists km_step_dirty on research_protocol_steps;
create trigger km_step_dirty before update on research_protocol_steps for each row execute function public.km_mark_dirty();

drop trigger if exists enforce_model_allowlist on public.profiles;
create trigger enforce_model_allowlist before insert or update on public.profiles for each row execute function public.enforce_model_allowlist();

drop trigger if exists guard_submission_provenance_trg on lab_submissions;
create trigger guard_submission_provenance_trg before insert or update on lab_submissions for each row execute function public.guard_submission_provenance();

drop trigger if exists guard_canvas_update_trg on course_canvas_items;
create trigger guard_canvas_update_trg before update on course_canvas_items for each row execute function public.guard_canvas_update();

drop trigger if exists guard_canvas_provenance_trg on course_canvas_items;
create trigger guard_canvas_provenance_trg before insert or update on course_canvas_items for each row execute function public.guard_canvas_provenance();

drop trigger if exists rp_guard_owner on research_projects;
create trigger rp_guard_owner before update on research_projects for each row execute function public.research_guard_owner();

drop trigger if exists dm_msg_touch on public.dm_messages;
create trigger dm_msg_touch after insert on public.dm_messages for each row execute function public.dm_touch_thread();
