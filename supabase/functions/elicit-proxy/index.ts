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
  const rate = { limit: r.headers.get('X-RateLimit-Limit'), remaining: r.headers.get('X-RateLimit-Remaining'), reset: r.headers.get('X-RateLimit-Reset') };
  return { status: r.status, ok: r.ok, body: o as any, rate };
}
// clinical trial → compact shape for the UI
function normTrial(t: any) {
  return {
    nctId: t.nctId || null, title: t.title || 'Untitled trial', summary: t.summary ? String(t.summary).slice(0, 600) : null, url: t.url || null,
    status: t.overallStatus || null, phase: Array.isArray(t.phase) ? t.phase : [], studyType: t.studyType || null,
    enrollment: (t.enrollmentCount != null ? t.enrollmentCount : null), conditions: Array.isArray(t.conditions) ? t.conditions.slice(0, 8) : [],
    interventions: Array.isArray(t.interventions) ? t.interventions.slice(0, 8) : [], sponsor: t.leadSponsor || null,
    startDate: t.startDate || null, completionDate: t.completionDate || null, hasResults: !!t.hasResults,
  };
}
// map an Elicit GetReportResponse onto our elicit_jobs columns
function reportPatch(g: any): any {
  const p: any = { status: g.status, url: g.url || null, is_public: false, updated_at: new Date().toISOString() };
  // only advance the stage when the API reports one — never clobber a known stage with null (avoids a "reset to step 1")
  if (g.executionStage) p.stage = g.executionStage;
  if (g.status === 'completed' && g.result) {
    p.result_title = g.result.title || null; p.result_summary = g.result.summary || null;
    p.result_body = g.result.reportBody || null; p.result_abstract = g.result.abstract || null;
    p.pdf_url = g.pdfUrl || null; p.docx_url = g.docxUrl || null;
  }
  if (g.status === 'failed') p.error = g.error || { message: 'Report failed' };
  return p;
}
// map an Elicit GetSystematicReviewResponse onto our elicit_jobs columns (staged PRISMA data + final report)
function srPatch(g: any): any {
  const p: any = { status: g.status, url: g.url || null, is_public: false, updated_at: new Date().toISOString() };
  // only advance the stage when the API reports one — never clobber a known stage with null (avoids a "reset to step 1")
  if (g.executionStage) p.stage = g.executionStage;
  // dataFreshness = when Elicit last wrote stage exports to S3 → persisted so the UI shows "updated Xm ago" on first paint
  if (g.dataFreshness !== undefined) p.data_freshness = g.dataFreshness ?? null;
  if (g.data) {
    p.stages = {
      search: g.data.search || null, screen: g.data.screen || null,
      fulltext: g.data.fulltext || null, extract: g.data.extract || null,
    };
    const rep = g.data.report;
    if (rep && rep.result) {
      p.result_title = rep.result.title || null; p.result_summary = rep.result.summary || null;
      p.result_body = rep.result.reportBody || null; p.result_abstract = rep.result.abstract || null;
      p.pdf_url = rep.pdf || null; p.docx_url = rep.docx || null;
      p.exports = { pdf: rep.pdf || null, docx: rep.docx || null, txt: rep.txt || null, bib: rep.bib || null, ris: rep.ris || null };
    }
  }
  if (g.status === 'failed') p.error = g.error || { message: 'Systematic review failed' };
  return p;
}
// Emit a one-shot in-app notification when a job crosses non-terminal → terminal.
// Called by every poll (foreground sr.status/job.status + the cron sweep) with the PRE-patch row;
// each caller only reaches this after a non-terminal guard, and the row is terminal once written, so the
// transition fires once. A payload-scoped existence check guards the rare cron/foreground double-poll race.
async function notifyDone(svc: any, row: any, patch: any, kind: string): Promise<void> {
  try {
    if (!TERMINAL.has(patch.status) || !row?.user_id) return;
    const { data: ex } = await svc.from('notifications').select('id')
      .eq('recipient_id', row.user_id).eq('kind', 'job').contains('payload', { job_id: row.id }).limit(1);
    if (ex && ex.length) return;
    const isSR = kind === 'sysreview';
    const ok = patch.status === 'completed';
    const title = (isSR ? 'Systematic review ' : 'Report ') + (ok ? 'ready' : 'failed');
    const body = String((ok ? (patch.result_title || row.result_title || row.research_question) : ((patch.error && patch.error.message) || (row.error && row.error.message) || 'The job could not be completed')) || '').slice(0, 300);
    await svc.from('notifications').insert({ recipient_id: row.user_id, kind: 'job', payload: { title, body, project_id: row.project_id || null, job_id: row.id, job_kind: kind, status: patch.status } });
  } catch (_e) { /* notifications are best-effort — never fail the poll on a notify error */ }
}
const GET_PATH: Record<string, string> = { report: '/api/v1/reports/', sysreview: '/api/v1/systematic-reviews/' };

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
      const { data: jobs } = await svc.from('elicit_jobs').select('id,elicit_id,kind,user_id,project_id,research_question,result_title,error')
        .in('kind', ['report', 'sysreview']).in('status', ['processing', 'unknown']).order('updated_at', { ascending: true }).limit(20);
      let refreshed = 0, done = 0;
      for (const j of jobs || []) {
        if (!j.elicit_id || !GET_PATH[j.kind]) continue;
        const g = await elicitCall(GET_PATH[j.kind] + encodeURIComponent(j.elicit_id) + '?include=reportBody', 'GET');
        const idField = j.kind === 'sysreview' ? g.body?.reviewId : g.body?.reportId;
        if (!g.ok || !idField) continue;
        const patch = j.kind === 'sysreview' ? srPatch(g.body) : reportPatch(g.body);
        await svc.from('elicit_jobs').update(patch).eq('id', j.id);
        await notifyDone(svc, j, patch, j.kind);   // notify the owner when it just finished — even with no tab open
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
        .select('id,kind,status,stage,research_question,result_title,result_summary,result_body,result_abstract,url,is_public,pdf_url,docx_url,error,created_at,updated_at,project_id')
        .eq('user_id', uid).eq('kind', 'report').order('created_at', { ascending: false }).limit(50);
      return json({ ok: true, jobs: rows || [] });
    }

    // ---- clinical-trials search (synchronous; shares Elicit's search rate-limit bucket) ----
    if (action === 'trials.search') {
      const gate = await assertEntitled(sb, 'elicit_trials'); if (gate) return gate;
      if (!ELICIT_KEY) return json({ error: 'The research engine is not configured on the server.' }, 503);
      const query = String(body.query || '').trim();
      if (!query) return json({ error: 'query required' }, 400);
      const cap = parseInt(Deno.env.get('ELICIT_TRIALS_DAILY') || '50', 10);
      const { data: over } = await sb.rpc('feature_over_budget', { p_key: 'elicit_trials', max_calls: cap });
      if (over === true) return json({ error: 'Daily trials-search limit reached — try again tomorrow.' }, 429);
      const mode = body.searchMode === 'keyword' ? 'keyword' : 'semantic';
      const maxResults = clampInt(body.maxResults, 1, 200, 50);
      const arr = (a: any) => Array.isArray(a) ? a.map((x: any) => String(x)).filter(Boolean).slice(0, 20) : [];
      const tf: any = {};
      if (arr(body.phase).length) tf.phase = arr(body.phase);
      if (arr(body.recruitmentStatus).length) tf.recruitmentStatus = arr(body.recruitmentStatus);
      if (body.hasResults === true) tf.hasResults = true;
      const reqBody: any = { query: query.slice(0, 1000), searchMode: mode, maxResults };
      // filters + keyword mode are mutually exclusive on Elicit → only attach in semantic mode
      if (mode === 'semantic' && Object.keys(tf).length) reqBody.trialFilters = tf;
      const cacheKey = hashStr('trials:' + JSON.stringify({ query, mode, tf, n: maxResults }));
      const { data: cached } = await sb.from('elicit_search_cache').select('results,ratelimit,fetched_at').eq('query_hash', cacheKey).maybeSingle();
      if (cached && cached.results && (Date.now() - new Date(cached.fetched_at).getTime() < 24 * 3600 * 1000)) {
        return json({ ok: true, trials: cached.results, rate: cached.ratelimit || null, cached: true });   // cache hit → free
      }
      const r = await elicitCall('/api/v1/search/trials', 'POST', reqBody);
      if (r.status === 402) return json({ error: 'Out of quota — an admin must top it up.' }, 402);
      if (r.status === 403) return json({ error: 'Trials search is not available on this plan.' }, 403);
      if (r.status === 429) return json({ error: 'Rate limit hit — try again shortly.', rate: r.rate }, 429);
      if (!r.ok) return json({ error: 'Trials search failed.', detail: r.status }, 502);
      const trials = (r.body.trials || []).map(normTrial);
      await sb.rpc('feature_usage_bump', { p_key: 'elicit_trials' });
      await sb.from('elicit_search_cache').upsert({ query_hash: cacheKey, query: query.slice(0, 300), corpus: 'trials', search_mode: mode, filters: tf, results: trials, ratelimit: r.rate, fetched_at: new Date().toISOString() });
      return json({ ok: true, trials, rate: r.rate });
    }

    if (action === 'report.create') {
      const gate = await assertEntitled(sb, 'elicit_reports'); if (gate) return gate;
      if (!ELICIT_KEY) return json({ error: 'The research engine is not configured on the server.' }, 503);
      const rq = String(body.researchQuestion || '').trim();
      if (!rq) return json({ error: 'researchQuestion required' }, 400);
      const { data: over } = await sb.rpc('feature_over_budget', { p_key: 'elicit_reports', max_calls: REPORTS_DAILY });
      if (over === true) return json({ error: 'Daily report limit reached — try again tomorrow.' }, 429);
      const qh = hashStr(rq.toLowerCase().replace(/\s+/g, ' '));
      const reqBody = {
        researchQuestion: rq.slice(0, 2000),
        title: body.title ? String(body.title).slice(0, 200) : undefined,
        maxSearchPapers: clampInt(body.maxSearchPapers, 10, 400, 200),
        maxExtractPapers: clampInt(body.maxExtractPapers, 5, 80, 30),   // API max is 80
        isPublic: false,
      };
      // CLAIM the slot before the expensive Elicit call — the partial unique index serializes concurrent
      // creates, so a double-click can't spawn two paid jobs (TOCTOU-safe, unlike a SELECT-then-INSERT dedup).
      const { data: claim, error: claimErr } = await sb.from('elicit_jobs').insert({
        user_id: uid, project_id: body.project_id || null, kind: 'report',
        research_question: rq.slice(0, 2000), q_hash: qh, status: 'processing', is_public: false, request: reqBody,
      }).select('id').single();
      if (claimErr) {
        const { data: dup } = await sb.from('elicit_jobs').select('id,elicit_id,status,stage,url')
          .eq('user_id', uid).eq('kind', 'report').eq('q_hash', qh).not('status', 'in', '(completed,failed)').limit(1);
        if (dup && dup.length) return json({ ok: true, job: dup[0], deduped: true });
        return json({ error: 'Could not create the report.' }, 500);
      }
      const cr = await elicitCall('/api/v1/reports', 'POST', reqBody);
      if (!cr.ok || !cr.body?.reportId) {
        await sb.from('elicit_jobs').delete().eq('id', claim.id);   // release the claimed slot on failure
        if (cr.status === 402) return json({ error: 'Out of quota — an admin must top it up.' }, 402);
        if (cr.status === 403) return json({ error: 'Reports are not available on this plan.' }, 403);
        if (cr.status === 429) return json({ error: 'Rate limit hit — try again shortly.' }, 429);
        return json({ error: 'Report creation failed.', detail: cr.status }, 502);
      }
      await sb.rpc('feature_usage_bump', { p_key: 'elicit_reports' });
      const { data: row } = await sb.from('elicit_jobs').update({ elicit_id: cr.body.reportId, status: cr.body.status || 'processing', url: cr.body.url || null })
        .eq('id', claim.id).select('id,kind,status,stage,research_question,url,is_public,created_at,updated_at,project_id').single();
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
      await notifyDone(svc, row, patch, 'report');   // in case the foreground poll is the one that observes completion
      return json({ ok: true, job: { ...row, ...patch } });
    }

    if (action === 'job.resume') {
      const gate = await assertEntitled(sb, 'elicit_reports'); if (gate) return gate;   // resume also consumes org quota → gate it
      const { data: row } = await sb.from('elicit_jobs').select('id,elicit_id,status').eq('id', body.job_id).maybeSingle();
      if (!row) return json({ error: 'job not found' }, 404);
      if (row.status !== 'pausedForInsufficientQuota') return json({ error: 'Only a paused (out-of-quota) job can be resumed.' }, 409);
      const rs = await elicitCall('/api/v1/reports/' + encodeURIComponent(row.elicit_id) + '/resume', 'POST');
      if (rs.status === 402) return json({ error: 'Still over quota — resolve the account quota, then resume.' }, 402);
      if (rs.status === 403) return json({ error: (rs.body && rs.body.error && rs.body.error.message) || 'Resume blocked (plan limit or max concurrent jobs).' }, 403);
      if (rs.status === 409) { await sb.from('elicit_jobs').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', row.id); return json({ ok: true, status: 'processing', note: 'already running' }); }
      if (!rs.ok) return json({ error: 'Resume failed.' }, 502);
      await sb.from('elicit_jobs').update({ status: rs.body.status || 'processing', stage: rs.body.executionStage ?? null, updated_at: new Date().toISOString() }).eq('id', row.id);
      return json({ ok: true, status: rs.body.status || 'processing' });
    }

    // ---- systematic reviews (Phase 3) ----
    if (action === 'sr.list') {
      const { data: rows } = await sb.from('elicit_jobs')
        .select('id,kind,status,stage,research_question,result_title,result_summary,result_body,result_abstract,url,is_public,pdf_url,docx_url,exports,stages,error,created_at,updated_at,data_freshness,project_id')
        .eq('user_id', uid).eq('kind', 'sysreview').order('created_at', { ascending: false }).limit(30);
      return json({ ok: true, jobs: rows || [] });
    }

    if (action === 'sr.create') {
      const gate = await assertEntitled(sb, 'elicit_sysreview'); if (gate) return gate;
      if (!ELICIT_KEY) return json({ error: 'The research engine is not configured on the server.' }, 503);
      const rq = String(body.researchQuestion || '').trim();
      if (!rq) return json({ error: 'researchQuestion required' }, 400);
      const cap = parseInt(Deno.env.get('ELICIT_SYSREVIEW_DAILY') || '1', 10);
      const { data: over } = await sb.rpc('feature_over_budget', { p_key: 'elicit_sysreview', max_calls: cap });
      if (over === true) return json({ error: 'Daily systematic-review limit reached — try again tomorrow.' }, 429);
      const qh = hashStr('sr:' + rq.toLowerCase().replace(/\s+/g, ' '));
      // Elicit wants each criterion / extraction question as an OBJECT {name(≤200), instructions(≤2000)},
      // NOT a plain string (a string 400s with "Expected object, received string"). The UI/candidates give
      // full-sentence strings → derive a short `name` label + keep the full sentence as `instructions`.
      const critArr = (a: any) => Array.isArray(a) ? a.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 20) : [];
      const toItem = (s: string) => ({ name: (s.length <= 90 ? s : s.slice(0, 88).replace(/\s+\S*$/, '') + '…').slice(0, 200), instructions: s.slice(0, 2000) });
      const absC = critArr(body.abstractCriteria).map(toItem);
      const ftC = critArr(body.fulltextCriteria).map(toItem);
      const exQ = critArr(body.extractionQuestions).map(toItem);
      // explicit AI-generate control (default ON); if no criteria/questions are given, generate is forced ON
      // (a screening/extraction stage can't be empty). useFigures = let extraction consult figures (slower).
      const genA = body.genAbstract !== false, genE = body.genExtraction !== false, useFig = body.useFigures === true;
      const runFT = body.runFullText !== false;   // omit fulltextScreening entirely to skip the full-text stage
      const abstractScreening: any = { generate: absC.length ? genA : true };
      if (absC.length) abstractScreening.criteria = absC;
      const extraction: any = { generate: exQ.length ? genE : true };
      if (exQ.length) extraction.questions = exQ;
      if (useFig) extraction.useFigures = true;
      const srBody: any = {
        researchQuestion: rq.slice(0, 2000),
        protocolDetails: body.protocolDetails ? String(body.protocolDetails).slice(0, 4000) : undefined,
        abstractScreening,
        extraction,
        generateReport: body.generateReport !== false,
        title: body.title ? String(body.title).slice(0, 200) : undefined,
        isPublic: false,
      };
      if (runFT) srBody.fulltextScreening = ftC.length ? { criteria: ftC, reuseAbstractCriteria: false } : { reuseAbstractCriteria: true };
      // explicit search size: build one semantic search over the elicit corpus at the requested maxResults.
      // Omitted/blank (maxR===0) → leave `searches` unset so Elicit runs its default plan-limited search (~thousands).
      const maxR = clampInt(body.maxResults, 1, 10000, 0);
      if (maxR >= 1) srBody.searches = [{ query: rq.slice(0, 2000), corpus: 'elicit', searchMode: 'semantic', maxResults: maxR }];
      // claim-first (TOCTOU-safe, unique index serializes concurrent creates)
      const { data: claim, error: claimErr } = await sb.from('elicit_jobs').insert({
        user_id: uid, project_id: body.project_id || null, kind: 'sysreview',
        research_question: rq.slice(0, 2000), q_hash: qh, status: 'processing', is_public: false, request: srBody,
      }).select('id').single();
      if (claimErr) {
        const { data: dup } = await sb.from('elicit_jobs').select('id,elicit_id,status,stage,url')
          .eq('user_id', uid).eq('kind', 'sysreview').eq('q_hash', qh).not('status', 'in', '(completed,failed)').limit(1);
        if (dup && dup.length) return json({ ok: true, job: dup[0], deduped: true });
        return json({ error: 'Could not create the review.' }, 500);
      }
      const cr = await elicitCall('/api/v1/systematic-reviews', 'POST', srBody);
      if (!cr.ok || !cr.body?.reviewId) {
        await sb.from('elicit_jobs').delete().eq('id', claim.id);
        if (cr.status === 402) return json({ error: 'Out of quota — an admin must top it up.' }, 402);
        if (cr.status === 403) return json({ error: (cr.body && cr.body.error && cr.body.error.message) || 'Systematic reviews unavailable (plan limit or max concurrent reviews reached).' }, 403);
        if (cr.status === 429) return json({ error: 'Rate limit hit — try again shortly.' }, 429);
        return json({ error: 'Systematic review creation failed.', detail: cr.status }, 502);
      }
      await sb.rpc('feature_usage_bump', { p_key: 'elicit_sysreview' });
      const { data: row } = await sb.from('elicit_jobs').update({ elicit_id: cr.body.reviewId, status: cr.body.status || 'processing', url: cr.body.url || null })
        .eq('id', claim.id).select('id,kind,status,stage,research_question,url,is_public,created_at,updated_at,project_id').single();
      return json({ ok: true, job: row });
    }

    if (action === 'sr.status') {
      const { data: row } = await sb.from('elicit_jobs').select('*').eq('id', body.job_id).maybeSingle();
      if (!row) return json({ error: 'job not found' }, 404);
      if (TERMINAL.has(row.status) || !row.elicit_id || !ELICIT_KEY) return json({ ok: true, job: row });
      const g = await elicitCall('/api/v1/systematic-reviews/' + encodeURIComponent(row.elicit_id) + '?include=reportBody', 'GET');
      if (!g.ok || !g.body?.reviewId) return json({ ok: true, job: row, stale: true });
      const patch = srPatch(g.body);
      await sb.from('elicit_jobs').update(patch).eq('id', row.id);
      await notifyDone(svc, row, patch, 'sysreview');   // in case the foreground poll is the one that observes completion
      return json({ ok: true, job: { ...row, ...patch } });
    }

    if (action === 'sr.resume') {
      const gate = await assertEntitled(sb, 'elicit_sysreview'); if (gate) return gate;   // resume also consumes org quota → gate it
      const { data: row } = await sb.from('elicit_jobs').select('id,elicit_id,status').eq('id', body.job_id).maybeSingle();
      if (!row) return json({ error: 'job not found' }, 404);
      if (row.status !== 'pausedForInsufficientQuota') return json({ error: 'Only a paused (out-of-quota) job can be resumed.' }, 409);
      const rs = await elicitCall('/api/v1/systematic-reviews/' + encodeURIComponent(row.elicit_id) + '/resume', 'POST');
      if (rs.status === 402) return json({ error: 'Still over quota — resolve the account quota, then resume.' }, 402);
      if (rs.status === 403) return json({ error: (rs.body && rs.body.error && rs.body.error.message) || 'Resume blocked (plan limit or max concurrent reviews).' }, 403);
      if (rs.status === 409) { await sb.from('elicit_jobs').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', row.id); return json({ ok: true, status: 'processing', note: 'already running' }); }
      if (!rs.ok) return json({ error: 'Resume failed.' }, 502);
      await sb.from('elicit_jobs').update({ status: rs.body.status || 'processing', stage: rs.body.executionStage ?? null, updated_at: new Date().toISOString() }).eq('id', row.id);
      return json({ ok: true, status: rs.body.status || 'processing' });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: 'Internal error' }, 500);
  }
});
