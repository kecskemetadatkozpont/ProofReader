// Publify — course-ops: instructor/admin operations for the course module (migrations 65-67).
// Action-based fn following the submission-ops pattern. Every action is gated by
// assertCourseInstructor (fail-closed RPC check), except create_course which is admin-only.
// The service-role client is used ONLY where a write must cross RLS on purpose
// (set_budget_bulk writes other users' budget rows); everything else runs on the
// caller-JWT client so RLS stays the authoritative guard.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { assertActive, assertCourseInstructor } from '../_shared/entitlement.ts';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
const CREDIT_SERVICES = ['llm', 'image', 'video', 'audio', 'search'];
function csvEsc(v: unknown) { const s = v == null ? '' : String(v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: ures } = await sb.auth.getUser();
    if (!ures || !ures.user) return json({ error: 'unauthorized' }, 401);
    const uid = ures.user.id;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const active = await assertActive(sb); if (active) return active;
    const courseId = String(body.course_id || '');

    // ---- create_course: admin only (matches the courses_insert RLS policy); owner = caller or a named instructor ----
    if (action === 'create_course') {
      const { data: admin, error: ae } = await sb.rpc('is_admin');
      if (ae || admin !== true) return json({ error: 'Kurzust csak admin hozhat létre.' }, 403);
      const title = String(body.title || '').trim();
      if (!title) return json({ error: 'Hiányzó kurzuscím (title).' }, 400);
      const row: any = { title, owner_id: String(body.owner_id || uid) };
      if (body.slug) row.slug = String(body.slug).trim();
      if (body.student_model) row.student_model = String(body.student_model);
      const { data, error } = await sb.from('courses').insert(row).select('id,title,slug,join_code,student_model,owner_id,active,created_at').single();
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, course: data });
    }

    // ---- seed_lectures: declarative upsert of the 1..12 lecture list on (course_id, ord) ----
    if (action === 'seed_lectures') {
      const gate = await assertCourseInstructor(sb, courseId); if (gate) return gate;
      const lectures = Array.isArray(body.lectures) ? body.lectures : [];
      if (!lectures.length) return json({ error: 'Hiányzó lectures tömb.' }, 400);
      const rows = lectures.map((l: any) => ({
        course_id: courseId,
        ord: Number(l.ord),
        title: String(l.title || '').trim(),
        summary: l.summary != null ? String(l.summary) : null,
        content_md: l.content_md != null ? String(l.content_md) : null,
      }));
      if (rows.some((r: any) => !Number.isInteger(r.ord) || r.ord < 1 || !r.title)) return json({ error: 'Minden előadáshoz egész ord (≥1) és title kell.' }, 400);
      const { data, error } = await sb.from('course_lectures').upsert(rows, { onConflict: 'course_id,ord' }).select('id,ord,title');
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, lectures: data || [] });
    }

    // ---- seed_assignment: manual upsert on (course_id, lecture_id, ord) — the table has no unique key for it ----
    if (action === 'seed_assignment') {
      const gate = await assertCourseInstructor(sb, courseId); if (gate) return gate;
      const lectureId = String(body.lecture_id || '');
      const title = String(body.title || '').trim();
      if (!lectureId || !title) return json({ error: 'Hiányzó lecture_id vagy title.' }, 400);
      const ord = Number.isInteger(Number(body.ord)) && Number(body.ord) >= 1 ? Number(body.ord) : 1;
      const row: any = {
        course_id: courseId, lecture_id: lectureId, ord, title,
        instructions_md: body.instructions_md != null ? String(body.instructions_md) : null,
        mcp_profile: body.mcp_profile && typeof body.mcp_profile === 'object' ? body.mcp_profile : {},
        due_at: body.due_at ? String(body.due_at) : null,
        team_based: !!body.team_based,
        rubric: body.rubric ?? null,
      };
      if (body.points_max != null && Number.isFinite(Number(body.points_max))) row.points_max = Number(body.points_max);
      const existing = (await sb.from('lab_assignments').select('id').eq('course_id', courseId).eq('lecture_id', lectureId).eq('ord', ord).maybeSingle()).data;
      const res = existing
        ? await sb.from('lab_assignments').update(row).eq('id', existing.id).select('id').single()
        : await sb.from('lab_assignments').insert(row).select('id').single();
      if (res.error) return json({ error: res.error.message }, 400);
      return json({ ok: true, assignment_id: res.data.id, updated: !!existing });
    }

    // ---- set_budget_bulk: upsert per-service credit grants for EVERY active student enrollment ----
    // Service client on purpose: the rows belong to other users — but only AFTER the instructor gate passed.
    // The payload omits `used`, so re-granting mid-semester never resets what students already spent.
    if (action === 'set_budget_bulk') {
      const gate = await assertCourseInstructor(sb, courseId); if (gate) return gate;
      const budgets = (Array.isArray(body.budgets) ? body.budgets : []).map((b: any) => ({ service: String(b.service || ''), granted: Number(b.granted) }));
      if (!budgets.length || budgets.some((b: any) => !CREDIT_SERVICES.includes(b.service) || !Number.isFinite(b.granted) || b.granted < 0))
        return json({ error: 'budgets: [{service: llm|image|video|audio|search, granted ≥ 0}] formátumban kell.' }, 400);
      const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const enr = (await svc.from('course_enrollments').select('user_id').eq('course_id', courseId).eq('status', 'active').eq('role', 'hallgato')).data || [];
      if (!enr.length) return json({ ok: true, students: 0, upserted: 0 });
      const now = new Date().toISOString();
      const rows: any[] = [];
      for (const e of enr) for (const b of budgets) rows.push({ course_id: courseId, user_id: e.user_id, service: b.service, granted: b.granted, updated_at: now });
      const { error } = await svc.from('course_credit_budgets').upsert(rows, { onConflict: 'course_id,user_id,service' });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, students: enr.length, upserted: rows.length });
    }

    // ---- grade: upsert lab_grades (1 grade / submission) + mark the submission graded ----
    if (action === 'grade') {
      const gate = await assertCourseInstructor(sb, courseId); if (gate) return gate;
      const sid = String(body.submission_id || '');
      const points = Number(body.points);
      if (!sid || !Number.isFinite(points)) return json({ error: 'Hiányzó submission_id vagy points.' }, 400);
      const sub = (await sb.from('lab_submissions').select('id').eq('id', sid).eq('course_id', courseId).maybeSingle()).data;
      if (!sub) return json({ error: 'A beadás nem található ebben a kurzusban.' }, 404);
      const { error: ge } = await sb.from('lab_grades').upsert({
        submission_id: sid, course_id: courseId, grader_id: uid, points,
        rubric_scores: body.rubric_scores ?? null,
        feedback_md: body.feedback_md != null ? String(body.feedback_md) : null,
      }, { onConflict: 'submission_id' });
      if (ge) return json({ error: ge.message }, 400);
      const { error: se } = await sb.from('lab_submissions').update({ status: 'graded', updated_at: new Date().toISOString() }).eq('id', sid);
      if (se) return json({ error: se.message }, 400);
      return json({ ok: true });
    }

    // ---- export_grades: semicolon-separated CSV — student; points per lab; total ----
    // Student names come from the migration-32 profiles_public view (the profiles base table stays locked).
    if (action === 'export_grades') {
      const gate = await assertCourseInstructor(sb, courseId); if (gate) return gate;
      const enr = (await sb.from('course_enrollments').select('user_id,team').eq('course_id', courseId).eq('status', 'active').eq('role', 'hallgato')).data || [];
      const lecs = (await sb.from('course_lectures').select('id,ord').eq('course_id', courseId)).data || [];
      const assignments = (await sb.from('lab_assignments').select('id,lecture_id,ord,title,points_max').eq('course_id', courseId)).data || [];
      const lecOrd = new Map(lecs.map((l: any) => [l.id, l.ord]));
      assignments.sort((a: any, b: any) => ((lecOrd.get(a.lecture_id) ?? 99) - (lecOrd.get(b.lecture_id) ?? 99)) || (a.ord - b.ord));
      const subs = (await sb.from('lab_submissions').select('id,assignment_id,user_id').eq('course_id', courseId)).data || [];
      const grades = (await sb.from('lab_grades').select('submission_id,points').eq('course_id', courseId)).data || [];
      const names = enr.length ? ((await sb.from('profiles_public').select('id,name').in('id', enr.map((e: any) => e.user_id))).data || []) : [];
      const nameById = new Map(names.map((p: any) => [p.id, p.name]));
      const ptsBySub = new Map(grades.map((g: any) => [g.submission_id, Number(g.points)]));
      const cell = new Map<string, number>(); // `${user_id}|${assignment_id}` -> points
      for (const s of subs) if (ptsBySub.has(s.id)) cell.set(s.user_id + '|' + s.assignment_id, ptsBySub.get(s.id)!);
      const header = ['Hallgató', 'Csapat', ...assignments.map((a: any) => `${lecOrd.get(a.lecture_id) ?? '?'}. ea — ${a.title} (max ${a.points_max})`), 'Összesen'];
      const lines = [header.map(csvEsc).join(';')];
      const sorted = enr.map((e: any) => ({ ...e, name: nameById.get(e.user_id) || e.user_id })).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), 'hu'));
      for (const e of sorted) {
        let total = 0;
        const cols = assignments.map((a: any) => {
          const p = cell.get(e.user_id + '|' + a.id);
          if (p == null) return '';
          total += p; return p;
        });
        lines.push([e.name, e.team || '', ...cols, total].map(csvEsc).join(';'));
      }
      return json({ ok: true, csv: lines.join('\r\n'), students: sorted.length, assignments: assignments.length });
    }

    // ---- audit_feed: mcp_call_log timeline for the instructor (RLS already scopes reads to their course) ----
    if (action === 'audit_feed') {
      const gate = await assertCourseInstructor(sb, courseId); if (gate) return gate;
      const lim = Math.min(Math.max(Number(body.limit) || 100, 1), 500);
      let q = sb.from('mcp_call_log')
        .select('id,assignment_id,user_id,provider,server,tool,model,prompt,params,response_meta,credits,status,created_at')
        .eq('course_id', courseId).order('created_at', { ascending: false }).limit(lim);
      if (body.user_id) q = q.eq('user_id', String(body.user_id));
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, calls: data || [] });
    }

    // ---- create_poll: open a canvas vote (e.g. prompt championship / week-12 awards) ----
    if (action === 'create_poll') {
      const gate = await assertCourseInstructor(sb, courseId); if (gate) return gate;
      const title = String(body.title || '').trim();
      if (!title) return json({ error: 'Hiányzó szavazás-cím (title).' }, 400);
      const row: any = { course_id: courseId, title, status: 'open' };
      if (body.lecture_id) row.lecture_id = String(body.lecture_id);
      if (body.category) row.category = String(body.category);
      const mvRaw = body.max_votes ?? body.max_votes_per_voter;   // both spellings accepted
      if (mvRaw != null) {
        const mv = Number(mvRaw);
        if (!Number.isInteger(mv) || mv < 1) return json({ error: 'max_votes: pozitív egész szám.' }, 400);
        row.max_votes_per_voter = mv;
      }
      const { data, error } = await sb.from('course_polls').insert(row).select('*').single();
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, poll: data });
    }

    // ---- set_poll_status: open/close a poll; on close return the top-3 tally ----
    // Back-compat aliases: {action:'open_poll'} / {action:'close_poll'} imply the status.
    if (action === 'set_poll_status' || action === 'open_poll' || action === 'close_poll') {
      const gate = await assertCourseInstructor(sb, courseId); if (gate) return gate;
      const pollId = String(body.poll_id || '');
      const status = action === 'open_poll' ? 'open' : action === 'close_poll' ? 'closed' : String(body.status || '');
      if (!pollId || !['open', 'closed'].includes(status)) return json({ error: "status: 'open' vagy 'closed'." }, 400);
      const { data: poll, error } = await sb.from('course_polls').update({ status }).eq('id', pollId).eq('course_id', courseId).select('id,title,status').maybeSingle();
      if (error) return json({ error: error.message }, 400);
      if (!poll) return json({ error: 'A szavazás nem található ebben a kurzusban.' }, 404);
      let results: { item_id: string; votes: number }[] = [];
      if (status === 'closed') {
        const votes = (await sb.from('course_poll_votes').select('item_id').eq('poll_id', pollId)).data || [];
        const tally = new Map<string, number>();
        for (const v of votes) tally.set(v.item_id, (tally.get(v.item_id) || 0) + 1);
        results = [...tally.entries()].map(([item_id, n]) => ({ item_id, votes: n }))
          .sort((a, b) => b.votes - a.votes).slice(0, 3);
      }
      return json({ ok: true, poll, results });
    }

    return json({ error: 'unknown action: ' + action }, 400);
  } catch (e) { return json({ error: String(e) }, 500); }
});
