// Publify — Citation Optimizer Edge Function.
// Analyzes what a project's top-cited INCLUDED papers are cited FOR, using Semantic Scholar citation
// contexts + Claude intent classification. Batched-synchronous (like research-study): each call does one
// bounded unit and the browser loops, so it never hits the edge timeout and naturally paces S2.
//
// Actions (all run under the CALLER's JWT — RLS scopes to the user's project):
//   run           {project_id}              → pick top-10 included (by citations), resolve to S2 ids,
//                                              create the report + one insight row per paper (pending).
//   analyze_paper {report_id, insight_id}   → fetch ONE paper's citation contexts, Claude-classify intent
//                                              + contributions + summary, aggregate, persist.
//   finalize      {report_id}               → synthesize the project-level citation strategy, mark done.
//   get           {project_id}              → latest report + its insights (for the viewer).
//
// Deploy:  supabase functions deploy citation-optimizer --no-verify-jwt
// Secrets: ANTHROPIC_API_KEY (reused); S2_API_KEY (optional — a free Semantic Scholar key; without it we
//          fall back to the shared unauthenticated pool + 429 backoff).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertActive, resolveModel } from '../_shared/entitlement.ts';
import { langDirective, loadProjectLang } from '../_shared/lang.ts';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const S2_KEY = Deno.env.get('S2_API_KEY') || '';
const S2 = 'https://api.semanticscholar.org/graph/v1';
const UA = 'Mozilla/5.0 (Publify CitationOptimizer; mailto:kecskemet.adatkozpont@gmail.com)';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function bareDoi(d: string): string { return String(d || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, '').trim(); }
function arxivId(d: string): string | null { const m = bareDoi(d).match(/arxiv\.([0-9]{4}\.[0-9]{4,5})/i); return m ? m[1] : null; }
function s2ref(r: any): string | null { const ax = arxivId(r && r.doi); if (ax) return 'ARXIV:' + ax; const d = bareDoi(r && r.doi); return d ? 'DOI:' + d : null; }

function s2headers(extra?: Record<string, string>): Record<string, string> { const h: Record<string, string> = { 'User-Agent': UA }; if (S2_KEY) h['x-api-key'] = S2_KEY; return { ...h, ...(extra || {}) }; }
async function s2get(path: string): Promise<any> {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(S2 + path, { headers: s2headers() });
    if (r.status === 429) { await sleep(1500 + a * 1800); continue; }
    if (!r.ok) throw new Error('s2 ' + r.status);
    return await r.json();
  }
  throw new Error('s2 429 (rate limited)');
}
async function s2batch(refs: string[]): Promise<any[]> {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(S2 + '/paper/batch?fields=title,citationCount,externalIds,venue,year', { method: 'POST', headers: s2headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ ids: refs }) });
    if (r.status === 429) { await sleep(1500 + a * 1800); continue; }
    if (!r.ok) throw new Error('s2 batch ' + r.status);
    return await r.json();
  }
  throw new Error('s2 batch 429');
}

async function callClaude(model: string, content: string, maxTokens: number): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content }] }),
  });
  const o = await r.json();
  if (o.error) throw new Error(o.error.message || 'anthropic');
  return (o.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
}
function parseJson(text: string, fallback: any): any { const m = String(text).match(/[\[{][\s\S]*[\]}]/); if (!m) return fallback; try { return JSON.parse(m[0]); } catch { return fallback; } }
const INTENTS = ['method', 'result', 'background', 'data', 'contrast'];
function emptyMix() { const m: Record<string, number> = {}; INTENTS.forEach((k) => (m[k] = 0)); return m; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: ures } = await sb.auth.getUser();
    if (!ures?.user?.id) return json({ error: 'unauthenticated' }, 401);
    const gate = await assertActive(sb); if (gate) return gate;

    const body = await req.json().catch(() => ({} as any));
    const action = String(body.action || '');

    // ---- run: build the report + insight rows for the top-10 included papers ----
    if (action === 'run') {
      const project_id = String(body.project_id || ''); if (!project_id) return json({ error: 'project_id required' }, 400);
      const { data: proj } = await sb.from('research_projects').select('id').eq('id', project_id).maybeSingle();
      if (!proj) return json({ error: 'project not found or no access' }, 404);
      const { data: srcs } = await sb.from('research_sources').select('id,title,doi,venue,year,cited_by')
        .eq('project_id', project_id).eq('screening', 'include').gte('cited_by', 1)
        .order('cited_by', { ascending: false }).limit(10);
      if (!srcs || !srcs.length) return json({ error: 'no_included', message: 'No included papers with a citation count to analyze.' }, 400);

      // resolve to Semantic Scholar (one batch call). A TRANSIENT failure (429/outage) must NOT be recorded
      // as a permanent "not indexed" verdict — bail with a retryable error and create no report, so the
      // client can simply try again. Only a SUCCESSFUL batch lets us mark a missing paper genuinely not-indexed.
      const refList = srcs.map(s2ref);
      const validRefs = refList.filter(Boolean) as string[];
      const resolved: Record<string, any> = {};
      if (validRefs.length) {
        let batch: any[];
        try { batch = await s2batch(validRefs); }
        catch (_e) { return json({ error: 's2_unavailable', retryable: true, message: 'Semantic Scholar is rate-limiting right now. Wait a moment and start the analysis again.' }, 503); }
        validRefs.forEach((ref, i) => { if (batch[i] && batch[i].paperId) resolved[ref] = batch[i]; });
      }

      const { data: rep, error: rerr } = await sb.from('citation_reports').insert({ project_id, status: 'processing', stats: { papers: srcs.length } }).select('id').single();
      if (rerr || !rep) return json({ error: rerr?.message || 'could not create report' }, 400);
      const report_id = rep.id;

      const rows = srcs.map((s: any, i: number) => {
        const ref = s2ref(s); const r = ref ? resolved[ref] : null; const has = !!(r && r.paperId);
        return { report_id, project_id, source_id: s.id, rank: i + 1, s2_id: has ? r.paperId : null, doi: s.doi, title: s.title, venue: s.venue, year: s.year, cited_by: s.cited_by, done: !has, summary: has ? null : 'Not indexed in Semantic Scholar.' };
      });
      await sb.from('citation_paper_insights').insert(rows);
      const { data: ins } = await sb.from('citation_paper_insights').select('id,source_id,s2_id,title,rank,done').eq('report_id', report_id).order('rank');
      return json({ ok: true, report_id, papers: ins || [] });
    }

    // ---- analyze_paper: one paper's citation contexts → classify → aggregate → persist ----
    if (action === 'analyze_paper') {
      const report_id = String(body.report_id || ''); const insight_id = String(body.insight_id || '');
      if (!report_id || !insight_id) return json({ error: 'report_id and insight_id required' }, 400);
      const { data: ins } = await sb.from('citation_paper_insights').select('*').eq('id', insight_id).maybeSingle();
      if (!ins) return json({ error: 'insight not found' }, 404);
      if (ins.done) return json({ ok: true, skipped: true });
      if (!ins.s2_id) { await sb.from('citation_paper_insights').update({ done: true }).eq('id', insight_id); return json({ ok: true, skipped: true }); }

      // A transient S2 failure must stay RETRYABLE — never persist it as a real zero with done=true. The
      // client retries; only after a few attempts do we mark the paper done with an honest, distinguishable
      // "unavailable" note (null counts, NOT 0) so finalize doesn't fold a rate-limit in as a genuine zero.
      const attempt = parseInt(String(body.attempt || '0'), 10) || 0;
      let cites: any[] = [];
      try { const cj = await s2get('/paper/' + encodeURIComponent(ins.s2_id) + '/citations?fields=contexts,isInfluential,intents,citingPaper.title,citingPaper.year&limit=400'); cites = cj.data || []; }
      catch (_e) {
        if (attempt < 2) return json({ ok: false, retryable: true, error: 's2_rate_limited', message: 'Semantic Scholar rate limit — retry this paper.' });
        await sb.from('citation_paper_insights').update({ done: true, summary: 'Citation contexts were unavailable (Semantic Scholar rate limit) — re-run the analysis later to include this paper.', citing_count: null, influential: null, intent_mix: null, contributions: [], contexts: [] }).eq('id', insight_id);
        return json({ ok: true, gave_up: true });
      }

      const withCtx = cites.filter((c) => c.contexts && c.contexts.length);
      const influential = cites.filter((c) => c.isInfluential).length;
      const picked = withCtx.slice().sort((a, b) => (b.isInfluential ? 1 : 0) - (a.isInfluential ? 1 : 0)).slice(0, 40);

      const mix = emptyMix();
      let contributions: any[] = [];
      let summary = '';
      const intentByIdx: Record<number, string> = {};
      if (picked.length) {
        const lines = picked.map((c, i) => '[' + i + '] "' + String(c.contexts[0] || '').replace(/\s+/g, ' ').slice(0, 300) + '" — citing: ' + String((c.citingPaper && c.citingPaper.title) || 'unknown').slice(0, 90) + ' (' + ((c.citingPaper && c.citingPaper.year) || '?') + ')').join('\n');
        const _lang = await loadProjectLang(sb, ins.project_id);
        const prompt = `You analyze how ONE paper is cited by others. Below is the cited paper and numbered sentences from papers that cite it (the citation contexts).
CITED PAPER: "${String(ins.title || '').slice(0, 200)}"${ins.venue ? ' (' + String(ins.venue).slice(0, 80) + (ins.year ? ', ' + ins.year : '') + ')' : ''}.
For EACH numbered sentence, classify why the citing author invoked this paper:
- "method": they reuse or build on its technique / model / algorithm / score.
- "result": they compare to its reported number, benchmark, or finding.
- "background": general context, motivation, or a related-work mention.
- "data": they use its dataset or benchmark.
- "contrast": they explicitly contrast with or differ from it.
Then list the specific contributions this paper is most cited FOR (short noun phrases, with how many sentences support each), and write a <=2 sentence plain summary of what it is cited for overall.
Sentences:
${lines}
Return ONLY JSON: {"classifications":[{"i":0,"intent":"method"}],"contributions":[{"label":"reconstruction anomaly score","count":12}],"summary":"..."}` + langDirective(_lang);
        try {
          const model = await resolveModel(sb);
          const out = await callClaude(model, prompt, 1600);
          const cls = parseJson(out, {});
          const classifications = Array.isArray(cls.classifications) ? cls.classifications : [];
          classifications.forEach((c: any) => { const k = String(c && c.intent || '').toLowerCase(); if (mix[k] !== undefined) mix[k]++; if (typeof c.i === 'number') intentByIdx[c.i] = k; });
          contributions = Array.isArray(cls.contributions) ? cls.contributions.slice(0, 6) : [];
          summary = String(cls.summary || '').slice(0, 700);
        } catch (_e) { /* keep empty mix/summary */ }
      } else {
        // successful fetch, but no readable context sentences — a genuine zero, distinct from a rate-limit
        summary = cites.length
          ? 'Indexed in Semantic Scholar with ' + cites.length + ' citing papers, but none had a readable context sentence to analyze.'
          : 'No citations are indexed for this paper yet.';
      }
      const ctxStore = picked.slice(0, 12).map((c, i) => ({ sentence: String(c.contexts[0] || '').replace(/\s+/g, ' ').slice(0, 320), intent: intentByIdx[i] || '', citing_title: String((c.citingPaper && c.citingPaper.title) || '').slice(0, 160), year: (c.citingPaper && c.citingPaper.year) || null, influential: !!c.isInfluential }));

      await sb.from('citation_paper_insights').update({ citing_count: cites.length, influential, intent_mix: mix, contributions, contexts: ctxStore, summary, done: true }).eq('id', insight_id);
      return json({ ok: true, with_ctx: withCtx.length, classified: picked.length });
    }

    // ---- finalize: project-level citation strategy across all analyzed papers ----
    if (action === 'finalize') {
      const report_id = String(body.report_id || ''); if (!report_id) return json({ error: 'report_id required' }, 400);
      const { data: rep } = await sb.from('citation_reports').select('id,project_id').eq('id', report_id).maybeSingle();
      if (!rep) return json({ error: 'report not found' }, 404);
      const { data: proj } = await sb.from('research_projects').select('title,field,goal,keywords').eq('id', rep.project_id).maybeSingle();
      const { data: insights } = await sb.from('citation_paper_insights').select('*').eq('report_id', report_id).order('rank');

      const totals = emptyMix(); let ctxCount = 0, infl = 0, resolved = 0;
      (insights || []).forEach((x: any) => { if (x.s2_id) resolved++; ctxCount += x.citing_count || 0; infl += x.influential || 0; const m = x.intent_mix || {}; INTENTS.forEach((k) => (totals[k] += (m[k] || 0))); });

      const summaries = (insights || []).filter((x: any) => x.summary && x.s2_id).map((x: any, i: number) => `[${i + 1}] "${String(x.title || '').slice(0, 140)}" (${x.cited_by || 0} cites): ${x.summary}`).join('\n');
      let strategy = '';
      if (summaries) {
        const kw = ((proj && proj.keywords) || []).join(', ');
        const _lang = await loadProjectLang(sb, rep.project_id);
        const prompt = `You advise a researcher on citation strategy for their paper, based on how their field cites the most important prior works.
Project: "${(proj && proj.title) || ''}"${(proj && proj.field) ? ' — field: ' + proj.field : ''}.${(proj && proj.goal) ? ' Goal: ' + proj.goal + '.' : ''}${kw ? ' Keywords: ' + kw + '.' : ''}
What the top-cited included papers are cited FOR:
${summaries}
Aggregate citation intent across all analyzed citations — method:${totals.method}, result:${totals.result}, background:${totals.background}, data:${totals.data}, contrast:${totals.contrast}.
Write a concise citation strategy in markdown (<=180 words) to optimize the researcher's protocol and journal write-up:
- one bold headline insight,
- 2-3 concrete, actionable recommendations ("When you introduce X, cite <paper> for its <contribution>, because that is how the field cites it"),
- name any uncrowded angle they could claim (e.g. if contrast is rare).
Return ONLY the markdown, no preamble.` + langDirective(_lang);
        try { const model = await resolveModel(sb); strategy = await callClaude(model, prompt, 1200); } catch (_e) { strategy = ''; }
      }
      await sb.from('citation_reports').update({ status: 'done', strategy, intent_totals: totals, stats: { papers: (insights || []).length, resolved, contexts: ctxCount, influential: infl }, updated_at: new Date().toISOString() }).eq('id', report_id);
      return json({ ok: true, strategy, intent_totals: totals, stats: { papers: (insights || []).length, resolved, contexts: ctxCount, influential: infl } });
    }

    // ---- get: latest report + insights for the viewer ----
    if (action === 'get') {
      const project_id = String(body.project_id || ''); if (!project_id) return json({ error: 'project_id required' }, 400);
      const { data: rep } = await sb.from('citation_reports').select('*').eq('project_id', project_id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!rep) return json({ ok: true, report: null, insights: [] });
      const { data: insights } = await sb.from('citation_paper_insights').select('*').eq('report_id', rep.id).order('rank');
      return json({ ok: true, report: rep, insights: insights || [] });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (_e) {
    return json({ error: 'Internal error' }, 500);
  }
});
