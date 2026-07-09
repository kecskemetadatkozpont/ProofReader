// Publify — Elicit proxy (Phase 2: automated reports). The ONLY holder of the org Elicit key.
//
// Actions (POST { action, ... }):
//   report.create  {researchQuestion, project_id?, title?, maxSearchPapers?, maxExtractPapers?}
//                  → gate elicit_reports + daily budget + pending-job idempotency → POST /reports → job row
//   job.status     {job_id}  → return the row; if non-terminal, refresh from Elicit GET /reports/{id}
//   job.resume     {job_id}  → resume a pausedForInsufficientQuota job (402 = still blocked, 409 = already running)
//   report.list             → the caller's own report jobs (NEVER the Elicit list endpoint — that leaks the org account)
//   cron_sweep              → (x-elicit-secret) service-role refresh of all non-terminal jobs; NO blind resume
//
// Auth: user path builds a caller-JWT client (getUser + the migration-49/50 entitlement RPCs);
//       cron path authenticates with x-elicit-secret and uses the service role.
// isPublic is ALWAYS false (research questions are unpublished). Deploy: --no-verify-jwt.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertEntitled } from '../_shared/entitlement.ts';

const ELICIT_KEY = Deno.env.get('ELICIT_API_KEY') || '';
const ELICIT_BASE = Deno.env.get('ELICIT_API_BASE') || 'https://elicit.com';
const CRON_SECRET = Deno.env.get('ELICIT_CRON_SECRET') || '';
const REPORTS_DAILY = parseInt(Deno.env.get('ELICIT_REPORTS_DAILY') || '3', 10);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-elicit-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const TERMINAL = new Set(['completed', 'failed']);
function hashStr(s: string): string { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }
function clampInt(v: any, lo: number, hi: number, def: number): number { const n = parseInt(String(v), 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; }

async function elicitCall(path: string, method: string, body?: any) {
  const r = await fetch(ELICIT_BASE + path, {
    method,
    headers: { 'Authorization': 'Bearer ' + ELICIT_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const o = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body: o as any };
}
// map an Elicit GetReportResponse onto our elicit_jobs columns
function reportPatch(g: any): any {
  const p: any = { status: g.status, stage: g.executionStage ?? null, url: g.url || null, is_public: !!g.isPublic, updated_at: new Date().toISOString() };
  if (g.status === 'completed' && g.result) {
    p.result_title = g.result.title || null; p.result_summary = g.result.summary || null;
    p.result_body = g.result.reportBody || null; p.result_abstract = g.result.abstract || null;
    p.pdf_url = g.pdfUrl || null; p.docx_url = g.docxUrl || null;
  }
  if (g.status === 'failed') p.error = g.error || { message: 'Report failed' };
  return p;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({} as any));
    const action = String(body.action || '');

    // ---- cron sweep (secret-authed; refresh only, no resume) ----
    if (action === 'cron_sweep') {
      if (!CRON_SECRET || req.headers.get('x-elicit-secret') !== CRON_SECRET) return json({ error: 'forbidden' }, 403);
      if (!ELICIT_KEY) return json({ ok: true, refreshed: 0, note: 'no key' });
      const { data: jobs } = await svc.from('elicit_jobs').select('id,elicit_id,kind')
        .eq('kind', 'report').in('status', ['processing', 'unknown']).order('updated_at', { ascending: true }).limit(20);
      let refreshed = 0, done = 0;
      for (const j of jobs || []) {
        if (!j.elicit_id) continue;
        const g = await elicitCall('/api/v1/reports/' + encodeURIComponent(j.elicit_id) + '?include=reportBody', 'GET');
        if (!g.ok || !g.body?.reportId) continue;
        const patch = reportPatch(g.body);
        await svc.from('elicit_jobs').update(patch).eq('id', j.id);
        refreshed++; if (patch.status === 'completed') done++;
      }
      return json({ ok: true, refreshed, done });
    }

    // ---- user path ----
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: ures } = await sb.auth.getUser();
    const uid = ures?.user?.id;
    if (!uid) return json({ error: 'unauthenticated' }, 401);

    // ---- report.list (own jobs only; never the Elicit list endpoint) ----
    if (action === 'report.list') {
      const { data: rows } = await sb.from('elicit_jobs')
        .select('id,kind,status,stage,research_question,result_title,result_summary,url,is_public,pdf_url,docx_url,error,created_at,updated_at,project_id')
        .eq('user_id', uid).eq('kind', 'report').order('created_at', { ascending: false }).limit(50);
      return json({ ok: true, jobs: rows || [] });
    }

    if (action === 'report.create') {
      const gate = await assertEntitled(sb, 'elicit_reports'); if (gate) return gate;
      if (!ELICIT_KEY) return json({ error: 'Elicit is not configured (no API key set on the server).' }, 503);
      const rq = String(body.researchQuestion || '').trim();
      if (!rq) return json({ error: 'researchQuestion required' }, 400);
      const { data: over } = await sb.rpc('feature_over_budget', { p_key: 'elicit_reports', max_calls: REPORTS_DAILY });
      if (over === true) return json({ error: 'Daily Elicit report limit reached — try again tomorrow.' }, 429);
      const qh = hashStr(rq.toLowerCase().replace(/\s+/g, ' '));
      // idempotency: reuse an in-flight job for the same question
      const { data: dup } = await sb.from('elicit_jobs').select('id,elicit_id,status,stage,url')
        .eq('user_id', uid).eq('kind', 'report').eq('q_hash', qh).not('status', 'in', '(completed,failed)').limit(1);
      if (dup && dup.length) return json({ ok: true, job: dup[0], deduped: true });
      // create on Elicit (isPublic ALWAYS false)
      const reqBody = {
        researchQuestion: rq.slice(0, 2000),
        title: body.title ? String(body.title).slice(0, 200) : undefined,
        maxSearchPapers: clampInt(body.maxSearchPapers, 10, 400, 200),
        maxExtractPapers: clampInt(body.maxExtractPapers, 5, 100, 30),
        isPublic: false,
      };
      const cr = await elicitCall('/api/v1/reports', 'POST', reqBody);
      if (cr.status === 402) return json({ error: 'The Elicit account is out of quota — an admin must top it up.' }, 402);
      if (cr.status === 403) return json({ error: 'The Elicit plan does not include reports.' }, 403);
      if (cr.status === 429) return json({ error: 'Elicit rate limit hit — try again shortly.' }, 429);
      if (!cr.ok || !cr.body?.reportId) return json({ error: 'Elicit report creation failed.', detail: cr.body?.error || cr.status }, 502);
      await sb.rpc('feature_usage_bump', { p_key: 'elicit_reports' });
      const { data: row, error: insErr } = await sb.from('elicit_jobs').insert({
        user_id: uid, project_id: body.project_id || null, kind: 'report', elicit_id: cr.body.reportId,
        research_question: rq.slice(0, 2000), q_hash: qh, status: cr.body.status || 'processing',
        url: cr.body.url || null, is_public: false, request: reqBody,
      }).select('id,kind,status,stage,research_question,url,is_public,created_at,updated_at,project_id').single();
      if (insErr) return json({ ok: true, job: { elicit_id: cr.body.reportId, status: cr.body.status || 'processing', url: cr.body.url }, note: 'created (row insert raced)' });
      return json({ ok: true, job: row });
    }

    if (action === 'job.status') {
      const { data: row } = await sb.from('elicit_jobs').select('*').eq('id', body.job_id).maybeSingle();
      if (!row) return json({ error: 'job not found' }, 404);
      if (TERMINAL.has(row.status) || !row.elicit_id || !ELICIT_KEY) return json({ ok: true, job: row });
      const g = await elicitCall('/api/v1/reports/' + encodeURIComponent(row.elicit_id) + '?include=reportBody', 'GET');
      if (!g.ok || !g.body?.reportId) return json({ ok: true, job: row, stale: true });
      const patch = reportPatch(g.body);
      await sb.from('elicit_jobs').update(patch).eq('id', row.id);
      return json({ ok: true, job: { ...row, ...patch } });
    }

    if (action === 'job.resume') {
      const { data: row } = await sb.from('elicit_jobs').select('id,elicit_id,status').eq('id', body.job_id).maybeSingle();
      if (!row) return json({ error: 'job not found' }, 404);
      if (row.status !== 'pausedForInsufficientQuota') return json({ error: 'Only a paused (out-of-quota) job can be resumed.' }, 409);
      const rs = await elicitCall('/api/v1/reports/' + encodeURIComponent(row.elicit_id) + '/resume', 'POST');
      if (rs.status === 402) return json({ error: 'Still over quota — resolve the Elicit account quota, then resume.' }, 402);
      if (rs.status === 409) { await sb.from('elicit_jobs').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', row.id); return json({ ok: true, status: 'processing', note: 'already running' }); }
      if (!rs.ok) return json({ error: 'Resume failed.' }, 502);
      await sb.from('elicit_jobs').update({ status: rs.body.status || 'processing', stage: rs.body.executionStage ?? null, updated_at: new Date().toISOString() }).eq('id', row.id);
      return json({ ok: true, status: rs.body.status || 'processing' });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
