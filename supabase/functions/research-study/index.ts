// Publify — Research Study Edge Function (Elicit-style 4-step literature funnel).
// Batched-synchronous: each call does one bounded unit (a search/screen page, or the review) and returns
// JSON; the browser loops. Runs under the CALLER's JWT (RLS scopes everything to the user's project).
//
// Actions:
//   search_step1   {study_id, offset, limit}  → OpenAlex search → upsert research_sources (dedup) →
//                                                research_study_papers(step1) → screen the page (metadata).
//   screen_batch   {study_id, step(2|3), offset, limit} → screen the next slice of prior-step includes.
//                                                step 2 = abstract; step 3 = OA full-text PDF (Claude
//                                                document block), abstract fallback.
//   generate_review {study_id}                → synthesize step-3 includes → research_files (markdown).
//
// Deploy:  supabase functions deploy research-study --no-verify-jwt
// Secrets: ANTHROPIC_API_KEY (reused); CONSENSUS_MCP_TOKEN (optional, grounds the review).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CONSENSUS_TOKEN = Deno.env.get('CONSENSUS_MCP_TOKEN');
const CONSENSUS_MCP_URL = Deno.env.get('CONSENSUS_MCP_URL') || 'https://mcp.consensus.app/mcp';
const DEFAULT_MODEL = Deno.env.get('RESEARCH_AI_MODEL') || 'claude-haiku-4-5-20251001';
const ALLOWED_MODELS = new Set(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
const REVIEW_MODEL = Deno.env.get('RESEARCH_REVIEW_MODEL') || 'claude-sonnet-4-6';
const PDF_MAX_BYTES = 14 * 1024 * 1024;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---- OpenAlex source adapter (the seam: keyed by config.source_adapter; only one today) ----------------
function abstractFromInverted(inv: any): string {
  if (!inv) return '';
  const out: string[] = [];
  for (const w in inv) for (const pos of inv[w]) out[pos] = w;
  return out.join(' ').slice(0, 1500);
}
function venueOf(w: any): string {
  return (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || w.host_venue?.display_name || '';
}
function normWork(w: any) {
  const authors = (w.authorships || []).slice(0, 8).map((a: any) => a.author && a.author.display_name).filter(Boolean);
  const oa = (w.open_access && w.open_access.oa_url) || (w.primary_location && w.primary_location.pdf_url) || '';
  return {
    ext_id: w.id, doi: w.doi || null, title: w.display_name || 'Untitled', authors,
    year: w.publication_year || null, venue: venueOf(w) || null,
    abstract: abstractFromInverted(w.abstract_inverted_index), cited_by: w.cited_by_count || 0,
    url: w.doi || w.id, oa_pdf_url: oa,
  };
}
async function openalexSearch(question: string, config: any, page: number, perPage: number) {
  const f = config.filters || {};
  const terms = [question, ...(config.keywords || [])].filter(Boolean).join(' ').trim();
  let url = 'https://api.openalex.org/works?search=' + encodeURIComponent(terms || question || '')
    + '&per-page=' + perPage + '&page=' + page + '&mailto=publify@example.com';
  const filters: string[] = [];
  if (f.fromYear) filters.push('from_publication_date:' + f.fromYear + '-01-01');
  if (f.minCites) filters.push('cited_by_count:>' + (parseInt(f.minCites, 10) - 1));
  if (f.oa) filters.push('is_oa:true');
  if (f.journals) filters.push('type:article');
  if (filters.length) url += '&filter=' + filters.join(',');
  const r = await fetch(url, { headers: { 'User-Agent': 'Publify/1.0 (mailto:publify@example.com)' } });
  if (!r.ok) return { papers: [], total: 0 };
  const o = await r.json();
  return { papers: (o.results || []).map(normWork), total: (o.meta && o.meta.count) || 0 };
}

async function fetchPdfBlock(url: string): Promise<any | null> {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Publify/1.0' } });
    clearTimeout(t);
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!/pdf/i.test(ct) && !/\.pdf($|\?)/i.test(url)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!buf.length || buf.length > PDF_MAX_BYTES) return null;
    let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: btoa(bin) } };
  } catch { return null; }
}

function screenSystem(question: string, config: any): string {
  const inc = (config.include || []).filter(Boolean);
  const exc = (config.exclude || []).filter(Boolean);
  return `You are screening papers for a systematic literature review.
Research question: ${question || '(none given)'}
${(config.keywords || []).length ? 'Keywords: ' + (config.keywords || []).join(', ') + '\n' : ''}${inc.length ? 'Inclusion criteria (the paper should plausibly satisfy ALL): ' + inc.join('; ') + '\n' : ''}${exc.length ? 'Exclusion criteria (exclude if ANY clearly holds): ' + exc.join('; ') + '\n' : ''}For each paper decide: "include" (relevant to the question and plausibly meets the inclusion criteria), "maybe" (relevant but you are genuinely unsure it meets a criterion), or "exclude" (off-topic, or clearly violates an exclusion criterion). This is a screening FUNNEL — be inclusive here; later steps narrow further. Prefer "maybe" over "exclude" when uncertain. Give a one-line reason, a 0..100 relevance score, and detect signals has_github (a public code repo) and has_dataset (a public dataset).
Return ONLY a JSON array, one object per paper in order: [{"i":0,"decision":"include|maybe|exclude","reason":"...","score":0,"signals":{"has_github":false,"has_dataset":false}}]`;
}

async function callClaude(model: string, system: string, content: any, useMcp: boolean, maxTokens: number) {
  const headers: Record<string, string> = { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  if (useMcp) headers['anthropic-beta'] = 'mcp-client-2025-04-04';
  const body: Record<string, unknown> = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] };
  if (useMcp) body.mcp_servers = [{ type: 'url', url: CONSENSUS_MCP_URL, name: 'consensus', authorization_token: CONSENSUS_TOKEN }];
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  const o = await r.json();
  if (o.error) throw new Error(o.error.message || 'anthropic');
  return (o.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
}
function parseDecisions(text: string): any[] {
  const m = text.match(/\[[\s\S]*\]/); if (!m) return [];
  try { return JSON.parse(m[0]); } catch { return []; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503);
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const study_id = String(body.study_id || '');
    if (!study_id) return json({ error: 'study_id required' }, 400);

    // RLS gate: the study is only visible if the caller can read the project.
    const { data: study } = await sb.from('research_studies').select('id,project_id,question,title').eq('id', study_id).maybeSingle();
    if (!study) return json({ error: 'study not found or no access' }, 404);
    const { data: ures } = await sb.auth.getUser();
    const uid = (ures && ures.user && ures.user.id) || '';
    const { data: prof } = await sb.from('profiles').select('ai_model').eq('id', uid).maybeSingle();
    const model = (prof && prof.ai_model && ALLOWED_MODELS.has(prof.ai_model)) ? prof.ai_model : DEFAULT_MODEL;

    // ---------------- generate_review (step 4) ----------------
    if (action === 'generate_review') {
      const { data: inc } = await sb.from('research_study_papers').select('source_id').eq('study_id', study_id).eq('step', 3).eq('decision', 'include');
      const ids = (inc || []).map((x: any) => x.source_id);
      if (!ids.length) return json({ error: 'No papers passed full-text screening yet.' }, 400);
      const { data: srcs } = await sb.from('research_sources').select('title,authors,year,venue,abstract,doi,url').in('id', ids);
      const list = (srcs || []).map((s: any, i: number) => `[${i + 1}] ${s.title} (${s.year || 'n.d.'}, ${s.venue || ''}). ${(s.authors || []).slice(0, 3).join(', ')}. ${s.doi || s.url || ''}\nAbstract: ${(s.abstract || '').slice(0, 800)}`).join('\n\n');
      const useMcp = !!CONSENSUS_TOKEN;
      const sys = `You are writing a concise structured literature REVIEW (Markdown) for the research question: ${study.question || study.title}. Use ONLY the ${ids.length} included papers below; cite them as [n]. Sections: ## Áttekintés, ## Fő témák és eredmények, ## Módszerek és adathalmazok, ## Hiányosságok (research gaps), ## Következtetés. ${useMcp ? 'Ground non-trivial claims with the Consensus tools and cite the papers.' : ''} Be specific and synthesize across papers — do not just list them. End with a ## Hivatkozások list.`;
      const md = await callClaude(REVIEW_MODEL, sys, `Included papers:\n\n${list}\n\nWrite the review now.`, useMcp, 8192);
      const slug = String(study.title || 'study').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'study';
      const sid8 = String(study_id).replace(/-/g, '').slice(0, 8);   // #9b: stable per-study id in the filename (unique + traceable, idempotent on re-run)
      const path = 'studies/' + slug + '-' + sid8 + '-review.md';
      await sb.from('research_files').upsert({ project_id: study.project_id, path, content: md, mime: 'text/markdown', size: md.length, source: 'ai', created_by: uid, updated_by: uid, updated_at: new Date().toISOString() }, { onConflict: 'project_id,path' });
      await sb.from('research_study_steps').update({ status: 'done', last_run_at: new Date().toISOString() }).eq('study_id', study_id).eq('step', 4);
      await sb.from('research_studies').update({ status: 'done', cur_step: 4, updated_at: new Date().toISOString() }).eq('id', study_id);
      return json({ ok: true, file_path: path, words: md.split(/\s+/).length });
    }

    const step = parseInt(String(body.step || '1'), 10);
    const offset = Math.max(0, parseInt(String(body.offset || '0'), 10));
    const { data: stepRow } = await sb.from('research_study_steps').select('config,counts').eq('study_id', study_id).eq('step', step).maybeSingle();
    const config = (stepRow && stepRow.config) || {};
    await sb.from('research_study_steps').update({ status: 'running', last_run_at: new Date().toISOString() }).eq('study_id', study_id).eq('step', step);

    // existing overridden decisions for this step → never clobber human judgment
    const { data: ovr } = await sb.from('research_study_papers').select('source_id').eq('study_id', study_id).eq('step', step).eq('overridden', true);
    const overridden = new Set((ovr || []).map((x: any) => x.source_id));

    // ---------------- search_step1 ----------------
    if (action === 'search_step1') {
      const limit = Math.min(25, Math.max(5, parseInt(String(body.limit || '20'), 10)));
      const page = Math.floor(offset / limit) + 1;
      const maxResults = Math.min(300, parseInt(String(config.max_results || '150'), 10));
      const { papers, total } = await openalexSearch(study.question || study.title, config, page, limit);
      let newSources = 0;
      const screenInputs: any[] = [];
      for (const p of papers) {
        const { data: srow } = await sb.from('research_sources').upsert({
          project_id: study.project_id, source_api: config.source_adapter || 'openalex', ext_id: p.ext_id,
          doi: p.doi, title: p.title, authors: p.authors.length ? p.authors : null, year: p.year, venue: p.venue,
          abstract: p.abstract || null, cited_by: p.cited_by, url: p.url, oa_pdf_url: p.oa_pdf_url || null, screening: 'unscreened',
        }, { onConflict: 'project_id,ext_id' }).select('id,created_at').maybeSingle();
        if (!srow) continue;
        await sb.from('research_study_papers').upsert({ study_id, source_id: srow.id, step: 1, decision: 'unscreened' }, { onConflict: 'study_id,source_id,step' });
        if (!overridden.has(srow.id)) screenInputs.push({ source_id: srow.id, oa_pdf_url: p.oa_pdf_url, ...p });
        newSources++;
      }
      const results = await screenAndWrite(sb, study, study_id, 1, config, model, screenInputs, false);
      const total_count = await recount(sb, study_id, 1);
      const nextOffset = offset + papers.length;
      const done = papers.length < limit || nextOffset >= maxResults;
      await finishBatch(sb, study_id, 1, nextOffset, total, done);
      return json({ ok: true, step: 1, fetched: papers.length, new_sources: newSources, counts: total_count, results, next_offset: nextOffset, done, total_estimate: total });
    }

    // ---------------- screen_batch (steps 2, 3) ----------------
    if (action === 'screen_batch' && (step === 2 || step === 3)) {
      const limit = step === 3 ? Math.min(4, Math.max(1, parseInt(String(body.limit || '3'), 10))) : Math.min(12, Math.max(4, parseInt(String(body.limit || '8'), 10)));
      const prevStep = step - 1;
      const { data: prev, count } = await sb.from('research_study_papers').select('source_id', { count: 'exact' }).eq('study_id', study_id).eq('step', prevStep).eq('decision', 'include').order('source_id').range(offset, offset + limit - 1);
      const ids = (prev || []).map((x: any) => x.source_id).filter((id: string) => !overridden.has(id));
      const total = count || 0;
      const inputs: any[] = [];
      if (ids.length) {
        const { data: srcs } = await sb.from('research_sources').select('id,title,abstract,year,venue,url,doi,oa_pdf_url').in('id', ids);
        const byId: Record<string, any> = {}; (srcs || []).forEach((s: any) => { byId[s.id] = s; });
        for (const id of ids) { const s = byId[id]; if (s) inputs.push({ source_id: s.id, oa_pdf_url: s.oa_pdf_url, title: s.title, abstract: s.abstract, year: s.year, venue: s.venue, url: s.url, doi: s.doi, _fullText: step === 3 }); }
      }
      const results = await screenAndWrite(sb, study, study_id, step, config, model, inputs, step === 3);
      const counts = await recount(sb, study_id, step);
      const nextOffset = offset + (prev || []).length;
      const done = (prev || []).length < limit || nextOffset >= total;
      await finishBatch(sb, study_id, step, nextOffset, total, done);
      return json({ ok: true, step, processed: (prev || []).length, counts, results, next_offset: nextOffset, done, total_estimate: total });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

// Screen a batch of papers with one Claude call, write research_study_papers(step), return UI rows.
async function screenAndWrite(sb: any, study: any, study_id: string, step: number, config: any, model: string, inputs: any[], fullText: boolean) {
  if (!inputs.length) return [];
  const sys = screenSystem(study.question || study.title, config);
  const content: any[] = [];
  const signalsBase: Record<string, any> = {};
  for (let i = 0; i < inputs.length; i++) {
    const p = inputs[i];
    let pdfBlock: any = null;
    if (fullText) pdfBlock = await fetchPdfBlock(p.oa_pdf_url || p.url);
    signalsBase[p.source_id] = { screened_on: pdfBlock ? 'pdf' : (fullText ? 'abstract' : 'metadata'), oa_pdf: !!pdfBlock };
    content.push({ type: 'text', text: `Paper ${i}:\nTitle: ${p.title}\nYear: ${p.year || ''}  Venue: ${p.venue || ''}\nURL: ${p.url || p.doi || ''}${pdfBlock ? '\n(full text PDF attached below)' : '\nAbstract: ' + (p.abstract || '(no abstract)')}` });
    if (pdfBlock) content.push(pdfBlock);
  }
  content.push({ type: 'text', text: `\nReturn the JSON array now (one object per paper, ${inputs.length} objects, field "i" = paper index).` });
  let decisions: any[] = [];
  try { decisions = parseDecisions(await callClaude(model, sys, content, false, 2048)); } catch { decisions = []; }
  const byIdx: Record<number, any> = {}; decisions.forEach((d: any) => { if (typeof d.i === 'number') byIdx[d.i] = d; });
  const out: any[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const p = inputs[i]; const d = byIdx[i] || {};
    const decision = ['include', 'maybe', 'exclude'].includes(d.decision) ? d.decision : 'maybe';
    const signals = Object.assign({}, signalsBase[p.source_id], (d.signals && typeof d.signals === 'object') ? d.signals : {});
    await sb.from('research_study_papers').upsert({ study_id, source_id: p.source_id, step, decision, reason: (d.reason || '').slice(0, 500), score: typeof d.score === 'number' ? Math.max(0, Math.min(100, d.score)) : null, signals, overridden: false }, { onConflict: 'study_id,source_id,step' });
    out.push({ source_id: p.source_id, title: p.title, decision, reason: d.reason || '', score: d.score, signals });
  }
  return out;
}
async function recount(sb: any, study_id: string, step: number) {
  const counts: Record<string, number> = { include: 0, maybe: 0, exclude: 0 };
  for (const dec of ['include', 'maybe', 'exclude']) {
    const { count } = await sb.from('research_study_papers').select('id', { count: 'exact', head: true }).eq('study_id', study_id).eq('step', step).eq('decision', dec);
    counts[dec] = count || 0;
  }
  return counts;
}
async function finishBatch(sb: any, study_id: string, step: number, cursor: number, total: number, done: boolean) {
  const counts = await recount(sb, study_id, step);
  await sb.from('research_study_steps').update({ cursor, total, counts, status: done ? 'done' : 'running', last_run_at: new Date().toISOString() }).eq('study_id', study_id).eq('step', step);
  if (done) await sb.from('research_studies').update({ cur_step: step, updated_at: new Date().toISOString() }).eq('id', study_id);
}
