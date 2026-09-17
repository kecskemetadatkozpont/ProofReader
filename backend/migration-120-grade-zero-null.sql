-- migration-120-grade-zero-null.sql
-- A pontok újraszámolása ne írjon jegyet annak, akinek még nincs egy pontja sem.
-- Enélkül a félév elején mindenki „1”-est kapna, ami félrevezető a hallgatói
-- kártyán, és véletlenül exportálható is. Kézzel beírt jegyet ez sem érint.
-- Előfeltétel: migration-118 + 119.

create or replace function public.course_grade_recalc(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sc jsonb; n int := 0; act_max numeric; runs int;
begin
  if not course_is_instructor(p_course) then raise exception 'Nincs jogosultság'; end if;
  sc := course_grade_scale(p_course);
  act_max := coalesce((sc->>'activity_points')::numeric, 0);
  select count(*) into runs from course_poll_runs where course_id = p_course;

  with lab as (
    select s.user_id, sum(g.points) as pts
      from lab_grades g join lab_submissions s on s.id = g.submission_id
     where g.course_id = p_course group by s.user_id),
  act as (
    select a.user_id, count(distinct a.run_id) as answered
      from course_poll_answers a where a.course_id = p_course group by a.user_id),
  base as (
    select r.claimed_by as user_id,
           coalesce(l.pts, 0) as lab,
           case when runs > 0 then round(coalesce(a.answered, 0)::numeric / runs * act_max, 1) else 0 end as activity
      from course_roster r
      left join lab l on l.user_id = r.claimed_by
      left join act a on a.user_id = r.claimed_by
     where r.course_id = p_course and r.claimed_by is not null)
  insert into course_grades (course_id, user_id, points, breakdown, grade, updated_by, updated_at)
  select p_course, user_id, lab + activity,
         jsonb_build_object('lab', lab, 'activity', activity),
         case when lab + activity > 0 then grade_from_points(lab + activity, sc) else null end,
         auth.uid(), now()
    from base
  on conflict (course_id, user_id) do update
    set points = excluded.points, breakdown = excluded.breakdown,
        grade = case when course_grades.manual then course_grades.grade else excluded.grade end,
        updated_by = auth.uid(), updated_at = now()
    where not course_grades.manual;
  get diagnostics n = row_count;
  insert into course_roster_access_log (course_id, actor, action, n) values (p_course, auth.uid(), 'grade', n);
  return jsonb_build_object('updated', n, 'polls', runs, 'activity_points', act_max);
end; $$;
