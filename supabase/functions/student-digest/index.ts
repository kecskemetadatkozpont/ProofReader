// Publify — Student Digest Edge Function.
// Summarises ONE student's research activity for a given day (their AI chat + research_log + ideas +
// literature + datasets/jobs) into a supervisor-facing report, using the same Anthropic key as the
// Ideas chat. Two modes:
//   • single:  { student_id, day? }  — invoked by a supervisor (their JWT). Reads are RLS-scoped, so a
//              supervisor only ever digests a student they can actually see; nothing if not authorised.
//   • batch:   { day?, batch:true }  — invoked by the daily cron with the SERVICE ROLE key; iterates
//              every supervised student with activity that day.
// Writes (report upsert + bell notification) use the service client. Reports are stored in
// student_daily_reports (migration-19) and a notification (kind='student_report') hits the bell.
//
// Deploy:  supabase functions deploy student-digest
// Secrets: ANTHROPIC_API_KEY (shared with research-chat). Optional: STUDENT_DIGEST_MODEL, STUDENT_DIGEST_MAX_TOKENS.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = Deno.env.get('STUDENT_DIGEST_MODEL') || Deno.env.get('RESEARCH_AI_MODEL') || 'claude-haiku-4-5-20251001';
const MAX_TOKENS = parseInt(Deno.env.get('STUDENT_DIGEST_MAX_TOKENS') || '900', 10);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

function dayBounds(day: string) {
  const d0 = new Date(day + 'T00:00:00Z');
  const d1 = new Date(d0.getTime() + 86400000);
  return { start: d0.toISOString(), end: d1.toISOString() };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503);
    const auth = req.headers.get('Authorization') || '';
    const body = await req.json().catch(() => ({}));
    const day: string = body.day || new Date().toISOString().slice(0, 10);
    const svc = createClient(URL, SERVICE);

    if (body.batch) {
      // only the service role may run a full batch (the daily cron)
      if (auth !== 'Bearer ' + SERVICE) return json({ error: 'batch requires the service role' }, 403);
      const { data: students } = await svc.from('phd_students').select('id,name,supervisor_id');
      const results: any[] = [];
      for (const s of (students || [])) results.push(await generateReport(svc, svc, s.id, day));
      return json({ ok: true, day, students: (students || []).length, generated: results.filter((r) => r.ok).length });
    }

    // single mode — supervisor (or admin) generating one student's report under their own JWT
    if (!body.student_id) return json({ error: 'student_id required' }, 400);
    const sb = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: ures } = await sb.auth.getUser();
    if (!ures || !ures.user) return json({ error: 'not signed in' }, 401);
    const r = await generateReport(sb, svc, body.student_id, day);
    return json({ ok: !!r.ok, day, ...r, model: MODEL });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

// Aggregate a student's day across sources, summarise with Claude, upsert the report + notify.
// `rc` reads (RLS-scoped under the caller's JWT in single mode, or the service client in batch); `svc`
// writes (report + notification) with the service role.
async function generateReport(rc: any, svc: any, studentId: string, day: string): Promise<any> {
  const { data: stu } = await rc.from('phd_students').select('id,name,supervisor_id').eq('id', studentId).maybeSingle();
  if (!stu) return { skipped: 'student not visible' };
  const { data: projs } = await rc.from('research_projects').select('id,title').eq('student_id', studentId);
  const pids = (projs || []).map((p: any) => p.id);
  if (!pids.length) return { skipped: 'no linked research project' };

  const { start, end } = dayBounds(day);
  const inDay = (q: any, col = 'created_at') => q.gte(col, start).lt(col, end);

  const { data: chats } = await rc.from('research_chats').select('id').in('project_id', pids);
  const cids = (chats || []).map((c: any) => c.id);
  let msgs: any[] = [];
  if (cids.length) {
    const r = await inDay(rc.from('research_messages').select('role,content,created_at').in('chat_id', cids)).order('created_at', { ascending: true });
    msgs = r.data || [];
  }
  const [logs, ideas, srcs, dsets, jobs] = await Promise.all([
    inDay(rc.from('research_log').select('type,summary,ts').in('project_id', pids), 'ts').order('ts', { ascending: true }).then((r: any) => r.data || []),
    inDay(rc.from('research_ideas').select('question,hypothesis,status').in('project_id', pids)).then((r: any) => r.data || []),
    inDay(rc.from('research_sources').select('title,screening').in('project_id', pids)).then((r: any) => r.data || []),
    inDay(rc.from('research_datasets').select('name,status').in('project_id', pids)).then((r: any) => r.data || []),
    inDay(rc.from('research_jobs').select('title,type,status').in('project_id', pids)).then((r: any) => r.data || []),
  ]);

  const counts = { chat_msgs: msgs.length, log_entries: logs.length, ideas: ideas.length, sources: srcs.length, jobs: jobs.length };
  const total = counts.chat_msgs + counts.log_entries + counts.ideas + counts.sources + counts.jobs;
  if (total === 0) return { skipped: 'no activity', counts };

  const transcript = msgs.slice(-50).map((m: any) => (m.role === 'user' ? 'DIÁK' : 'AI') + ': ' + (m.content || '')).join('\n').slice(0, 9000);
  const ctx = [
    `Diák: ${stu.name}. Projekt(ek): ${(projs || []).map((p: any) => p.title).join('; ')}. Nap: ${day}.`,
    msgs.length ? `\n=== AI-beszélgetés (aznapi) ===\n${transcript}` : '',
    logs.length ? `\n=== Kutatási napló ===\n${logs.map((l: any) => `[${l.type}] ${l.summary}`).join('\n')}` : '',
    ideas.length ? `\n=== Új ötletek / hipotézisek ===\n${ideas.map((i: any) => `- ${i.question}${i.hypothesis ? ' (H: ' + i.hypothesis + ')' : ''} [${i.status}]`).join('\n')}` : '',
    srcs.length ? `\n=== Irodalom (szűrés) ===\n${srcs.map((s: any) => `- ${s.title} [${s.screening}]`).join('\n')}` : '',
    dsets.length ? `\n=== Adathalmazok ===\n${dsets.map((d: any) => `- ${d.name} [${d.status}]`).join('\n')}` : '',
    jobs.length ? `\n=== Compute jobok ===\n${jobs.map((j: any) => `- ${j.title} (${j.type}) [${j.status}]`).join('\n')}` : '',
  ].filter(Boolean).join('\n');

  const SYSTEM = `Te egy doktori témavezető asszisztense vagy. A megadott NAPI kutatási aktivitásból (AI-beszélgetés, kutatási napló, ötletek, irodalom, adat/compute) készíts tömör, magyar nyelvű napi összefoglalót a TÉMAVEZETŐ számára: mit dolgozott a diák, milyen DÖNTÉSEKET hozott, és milyen kérdések maradtak nyitva. Kizárólag a megadott tartalomra támaszkodj — ne találj ki semmit, ne általánosíts. Válaszolj KIZÁRÓLAG egyetlen JSON objektummal, ezekkel a mezőkkel (mind string-tömb, kivéve work_summary): work_summary (2–4 mondatos szöveg), decisions, open_questions, ideas, topics, blockers (ahol a diák elakadt vagy iránymutatás kell — lehet üres tömb).`;
  const reqBody = { model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM, messages: [{ role: 'user', content: ctx }] };
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(reqBody) });
  const out = await r.json();
  if (out.error) return { error: 'anthropic: ' + (out.error.message || JSON.stringify(out.error)) };
  const text = (out.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  let summary: any;
  try { summary = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')); }
  catch { summary = { work_summary: text }; }

  // resolve the supervisor to notify (primary link, then an accepted supervision)
  let supId: string | null = stu.supervisor_id || null;
  if (!supId) {
    const { data: sv } = await svc.from('phd_supervisions').select('supervisor_id').eq('student_id', studentId).eq('status', 'accepted').limit(1).maybeSingle();
    supId = (sv && sv.supervisor_id) || null;
  }

  const { error: upErr } = await svc.from('student_daily_reports').upsert(
    { student_id: studentId, day, supervisor_id: supId, summary, ...counts, generated_at: new Date().toISOString(), model: MODEL },
    { onConflict: 'student_id,day' });
  if (upErr) return { error: 'upsert failed: ' + upErr.message };
  if (supId) await svc.from('notifications').insert({ recipient_id: supId, kind: 'student_report', payload: { student_id: studentId, student: stu.name, day, msgs: counts.chat_msgs, decisions: (summary.decisions || []).length } });

  return { ok: true, student: stu.name, counts, supervisor_id: supId, usage: out.usage };
}
