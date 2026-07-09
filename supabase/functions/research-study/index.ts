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
import { assertEntitled, resolveModel } from '../_shared/entitlement.ts';

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
  // journal ISSN(s) → the client maps these to the SCImago/Scopus quartile (Q1–Q4)
  const src = (w.primary_location && w.primary_location.source) || {};
  const issns: string[] = [];
  if (src.issn_l) issns.push(src.issn_l);
  if (Array.isArray(src.issn)) for (const i of src.issn) issns.push(i);
  const issn = Array.from(new Set(issns.map((s: any) => String(s || '').replace(/[^0-9Xx]/g, '').toUpperCase()).filter((s: string) => s.length === 8))).join(',');
  return {
    ext_id: w.id, doi: w.doi || null, title: w.display_name || 'Untitled', authors,
    year: w.publication_year || null, venue: venueOf(w) || null,
    abstract: abstractFromInverted(w.abstract_inverted_index), cited_by: w.cited_by_count || 0,
    url: w.doi || w.id, oa_pdf_url: oa, issn, source: 'openalex',
  };
}
// ---- Crossref fallback adapter (free, no key) — used when OpenAlex search is rate-limited/unavailable -------
function stripJats(s: string): string { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500); }
function normCrossref(it: any) {
  const doi = it.DOI || '';
  const authors = (it.author || []).slice(0, 8).map((a: any) => [a.given, a.family].filter(Boolean).join(' ').trim()).filter(Boolean);
  const yr = it.issued && it.issued['date-parts'] && it.issued['date-parts'][0] && it.issued['date-parts'][0][0];
  const issns = (it.ISSN || []).map((s: any) => String(s || '').replace(/[^0-9Xx]/g, '').toUpperCase()).filter((s: string) => s.length === 8);
  return {
    ext_id: doi ? 'crossref:' + doi : (it.URL || ''), doi: doi || null, title: (it.title && it.title[0]) || 'Untitled', authors,
    year: yr || null, venue: (it['container-title'] && it['container-title'][0]) || null,
    abstract: stripJats(it.abstract), cited_by: it['is-referenced-by-count'] || 0,
    url: doi ? 'https://doi.org/' + doi : (it.URL || ''), oa_pdf_url: '', issn: issns.join(','), source: 'crossref',
  };
}
async function crossrefFetch(terms: string, perPage: number) {
  if (!terms) return { papers: [] as any[] };
  const url = 'https://api.crossref.org/works?query=' + encodeURIComponent(terms) + '&rows=' + perPage +
    '&select=DOI,title,author,issued,container-title,abstract,is-referenced-by-count,ISSN,URL&mailto=kecskemet.adatkozpont@gmail.com';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Publify/1.0 (mailto:kecskemet.adatkozpont@gmail.com)' } });
    if (!r.ok) return { papers: [] as any[] };
    const o = await r.json();
    return { papers: (((o.message && o.message.items) || []).map(normCrossref)).filter((p: any) => p.title && p.ext_id) };
  } catch (_e) { return { papers: [] as any[] }; }
}
// Strip characters the OpenAlex `search` parser rejects — notably '?' (a sentence question returns "Invalid
// query parameters error" + 0 results), quotes, brackets, boolean operators, +, =, etc.
function cleanTerms(s: string): string {
  return String(s || '').replace(/[?!"'`(){}\[\]:;^~*\\\/|&<>+=#@%$]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 350);
}
const OA_KEY = Deno.env.get('OPENALEX_API_KEY') || '';   // OpenAlex now rate-limits anonymous search → free API key required
async function openalexFetch(terms: string, filters: string[], page: number, perPage: number) {
  if (!terms) return { papers: [], total: 0 };
  let url = 'https://api.openalex.org/works?search=' + encodeURIComponent(terms)
    + '&per-page=' + perPage + '&page=' + page + '&mailto=kecskemet.adatkozpont@gmail.com';
  if (OA_KEY) url += '&api_key=' + OA_KEY;
  if (filters.length) url += '&filter=' + filters.join(',');
  const r = await fetch(url, { headers: { 'User-Agent': 'Publify/1.0 (mailto:publify@example.com)' } });
  if (!r.ok) return { papers: [], total: 0 };
  const o = await r.json();
  if (o && o.error) return { papers: [], total: 0 };   // bad query → nothing, don't crash the batch
  return { papers: (o.results || []).map(normWork), total: (o.meta && o.meta.count) || 0 };
}
async function openalexSearch(question: string, config: any, page: number, perPage: number) {
  const f = config.filters || {};
  const kws = (config.keywords || []).map(cleanTerms).filter(Boolean);
  const qClean = cleanTerms(question);
  const filters: string[] = [];
  if (f.fromYear) filters.push('from_publication_date:' + f.fromYear + '-01-01');
  if (f.minCites) filters.push('cited_by_count:>' + (parseInt(f.minCites, 10) - 1));
  if (f.oa) filters.push('is_oa:true');
  if (f.journals) filters.push('type:article');
  const primary = kws.join(' ') || qClean || 'research';
  // tier 1: keywords + filters
  let res: any = await openalexFetch(primary, filters, page, perPage); res.relaxed = false;
  // progressively RELAX (only worth retrying on the first page) so a too-narrow query/too-strict filter set
  // doesn't silently return nothing: drop filters → fewer keywords → the question.
  if (res.total === 0 && page <= 1 && filters.length) { res = await openalexFetch(primary, [], page, perPage); res.relaxed = true; }
  if (res.total === 0 && page <= 1 && kws.length > 3) { res = await openalexFetch(kws.slice(0, 3).join(' '), [], page, perPage); res.relaxed = true; }
  if (res.total === 0 && page <= 1 && qClean && qClean !== primary) { res = await openalexFetch(qClean, [], page, perPage); res.relaxed = true; }
  return res;
}
// Per-keyword UNION sweep. Joining all keywords into ONE query is over-specific — OpenAlex relevance-matches
// most terms, so e.g. 8 keywords return only ~7 papers. Searching EACH keyword separately and unioning (dedup
// by ext_id) gives broad, thorough coverage (~190+ papers), matching a proper Elicit-style screen.
async function openalexUnion(question: string, config: any, maxResults: number) {
  const f = config.filters || {};
  const filters: string[] = [];
  if (f.fromYear) filters.push('from_publication_date:' + f.fromYear + '-01-01');
  if (f.minCites) filters.push('cited_by_count:>' + (parseInt(f.minCites, 10) - 1));
  if (f.oa) filters.push('is_oa:true');
  if (f.journals) filters.push('type:article');
  const kws = (config.keywords || []).map(cleanTerms).filter(Boolean);
  const queries = kws.length ? kws : [cleanTerms(question)].filter(Boolean);
  if (!queries.length) return { papers: [] as any[], relaxed: false };
  const perKw = Math.max(10, Math.min(40, Math.ceil(maxResults / queries.length) + 6));
  const seen = new Set<string>();
  const out: any[] = [];
  for (const q of queries) {
    if (out.length >= maxResults) break;
    let res = await openalexFetch(q, filters, 1, perKw);
    if (res.total === 0 && filters.length) res = await openalexFetch(q, [], 1, perKw);   // relax filters for this keyword
    if (!res.papers.length) { const cr = await crossrefFetch(q, perKw); res = { papers: cr.papers, total: cr.papers.length }; }   // OpenAlex empty/rate-limited → Crossref fallback
    for (const p of res.papers) {
      if (!p.ext_id || seen.has(p.ext_id)) continue;
      seen.add(p.ext_id); out.push(p);
      if (out.length >= maxResults) break;
    }
  }
  // ultimate fallback: nothing found per-keyword → single-query OpenAlex, then Crossref
  if (!out.length) {
    const r = await openalexSearch(question, config, 1, Math.min(50, maxResults));
    if (r.papers && r.papers.length) return { papers: r.papers, relaxed: true };
    const cr = await crossrefFetch(cleanTerms(question), Math.min(50, maxResults));
    return { papers: cr.papers, relaxed: true };
  }
  return { papers: out, relaxed: false };
}

// ---- Elicit source adapter (semantic/keyword search over 138M+ papers) -------------------------------
//  Gated by the elicit_search entitlement + a per-user daily budget (migration-50). The org key lives
//  only here (ELICIT_API_KEY secret). On any denial / rate-limit (429) / quota (402) / plan (403) / outage
//  the caller falls back to OpenAlex, so the study always completes. Maps Elicit Paper[] to the same
//  normalized shape the OpenAlex/Crossref adapters produce.
const ELICIT_KEY = Deno.env.get('ELICIT_API_KEY') || '';
const ELICIT_BASE = Deno.env.get('ELICIT_API_BASE') || 'https://elicit.com';
function normDoi(d: string): string { return String(d || '').toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim(); }
function normElicit(p: any) {
  const doi = p.doi ? normDoi(p.doi) : '';
  const urls: string[] = Array.isArray(p.urls) ? p.urls : [];
  const pdf = urls.find((u) => /\.pdf($|\?)|\/pdf/i.test(u)) || '';
  const ext = doi ? 'doi:' + doi : (p.elicitId ? 'elicit:' + p.elicitId : (p.pmid ? 'pmid:' + p.pmid : 'elicit:' + String(p.title || '').slice(0, 40)));
  return {
    ext_id: ext, doi: doi || null, title: p.title || 'Untitled',
    authors: Array.isArray(p.authors) ? p.authors.slice(0, 8) : [],
    year: p.year || null, venue: p.venue || null,
    abstract: String(p.abstract || '').slice(0, 1500), cited_by: p.citedByCount || 0,
    url: doi ? 'https://doi.org/' + doi : (urls[0] || ''), oa_pdf_url: pdf, issn: '', source: 'elicit',
  };
}
function elicitFilters(config: any) {
  const f = config.filters || {};
  const out: any = {};
  if (f.fromYear) out.minYear = parseInt(f.fromYear, 10);
  if (config.maxQuartile) out.maxQuartile = parseInt(config.maxQuartile, 10);
  return out;
}
async function elicitSearch(question: string, config: any, maxResults: number, mode: string, semantic: string) {
  if (!ELICIT_KEY) return { papers: [] as any[], rate: null as any, error: 'no_key' };
  const kws = (config.keywords || []).filter(Boolean);
  // KEYWORD mode: OR-join the keyword bag (unchanged). SEMANTIC mode: prefer the natural-language
  // query (semantic_query → study.question) — a well-formed question embeds far better than a keyword bag.
  let query: string;
  if (mode === 'keyword') {
    query = (kws.length ? kws.join(' OR ') : (semantic || question)) || question || 'research';
  } else {
    query = ((semantic || question || '').trim()) || (kws.length ? kws.join(' ') : '') || 'research';
  }
  query = query.slice(0, 350);   // Elicit query cap (unconditional)
  const b: any = { query, searchMode: mode === 'keyword' ? 'keyword' : 'semantic', maxResults: Math.min(300, Math.max(1, maxResults)), corpus: config.corpus === 'pubmed' ? 'pubmed' : 'elicit' };
  // filters and keyword mode are mutually exclusive on Elicit → only attach filters in semantic mode
  if (b.searchMode === 'semantic') { const fl = elicitFilters(config); if (Object.keys(fl).length) b.filters = fl; }
  let r: Response;
  try {
    r = await fetch(ELICIT_BASE + '/api/v1/search', { method: 'POST', headers: { 'Authorization': 'Bearer ' + ELICIT_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  } catch (_e) { return { papers: [], rate: null, error: 'network' }; }
  const rate = { limit: r.headers.get('X-RateLimit-Limit'), remaining: r.headers.get('X-RateLimit-Remaining'), reset: r.headers.get('X-RateLimit-Reset') };
  if (r.status === 429) return { papers: [], rate, error: 'rate_limited' };
  if (r.status === 402) return { papers: [], rate, error: 'quota' };
  if (r.status === 403) return { papers: [], rate, error: 'plan' };
  if (!r.ok) return { papers: [], rate, error: 'http_' + r.status };
  const o = await r.json().catch(() => ({}));
  // dedupe by ext_id (Elicit can return near-duplicates, e.g. two records sharing a DOI) so the cached
  // + upserted set is clean and the onConflict upsert never hits a same-batch duplicate.
  const seen = new Set<string>(); const papers: any[] = [];
  for (const p of (o.papers || []).map(normElicit)) { if (!p.ext_id || seen.has(p.ext_id)) continue; seen.add(p.ext_id); papers.push(p); }
  return { papers, rate, error: null };
}
// small stable hash for the shared search-cache key
function hashStr(s: string): string { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }

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

function screenSystem(question: string, config: any, step: number): string {
  const inc = (config.include || []).filter(Boolean);
  const exc = (config.exclude || []).filter(Boolean);
  const head = `Research question: ${question || '(none given)'}
${(config.keywords || []).length ? 'Keywords: ' + (config.keywords || []).join(', ') + '\n' : ''}${inc.length ? 'Inclusion criteria (the paper should plausibly satisfy ALL): ' + inc.join('; ') + '\n' : ''}${exc.length ? 'Exclusion criteria (exclude if ANY clearly holds): ' + exc.join('; ') + '\n' : ''}`;
  if (step >= 2) {
    // Step 2 (abstract) / Step 3 (full text) — RIGOROUS screening that NARROWS the funnel (not inclusive).
    const basis = step === 3 ? 'the FULL TEXT (the attached PDF when present, otherwise the abstract)' : 'the ABSTRACT';
    return `You are doing RIGOROUS ${step === 3 ? 'full-text' : 'abstract'} screening for a systematic literature review. This step NARROWS the set — be DISCERNING, not inclusive.
${head}
Judge each paper strictly from ${basis}:
- "include" ONLY if the text gives EXPLICIT evidence it plausibly meets ALL inclusion criteria;
- "exclude" if any exclusion criterion clearly holds, or it does not actually address the research question;
- "maybe" only when the text is genuinely ambiguous (e.g. no abstract is available).
For each paper return, in order (score is an INTEGER 0–100):
[{"i":0,"decision":"include|maybe|exclude","score":85,
  "criteria":{"inc":["short labels of the inclusion criteria it MEETS"],"exc":["short labels of any exclusion criteria that APPLY"]},
  "extract":{"method":"the paper's method/approach in <=12 words","dataset":"dataset(s) used, or 'none stated'","finding":"the key result/claim in <=15 words"},
  "signals":{"has_github":false,"has_dataset":false},
  "reason":"one-line justification"}]
Return ONLY the JSON array.`;
  }
  // Step 1 — fast, inclusive triage (kept identical to the client-side preview, buildScreenPrompt).
  return `You are screening papers for a systematic literature review.
${head}For each paper decide: "include" (relevant to the question and plausibly meets the inclusion criteria), "maybe" (relevant but you are genuinely unsure it meets a criterion), or "exclude" (off-topic, or clearly violates an exclusion criterion). This is a screening FUNNEL — be inclusive here; later steps narrow further. Prefer "maybe" over "exclude" when uncertain. Give a one-line reason, a 0..100 relevance score, and detect signals has_github (a public code repo) and has_dataset (a public dataset).
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
// AI-prefill the whole 4-step funnel config from the project + the study's question(s) — the user just fine-tunes.
async function planStudy(study: any, proj: any, model: string): Promise<any> {
  const kw = ((proj && proj.keywords) || []).join(', ');
  const prompt = `You are configuring an Elicit-style 4-step literature screening funnel so a researcher only fine-tunes it. Tailor EVERYTHING to the question(s) below.

Project: "${(proj && proj.title) || study.title || ''}"${(proj && proj.field) ? ' — field: ' + proj.field : ''}.${(proj && proj.goal) ? ' Goal: ' + proj.goal + '.' : ''}${kw ? ' Project keywords: ' + kw + '.' : ''}
Research question(s) / ideas this study is based on:
${study.question || study.title || ''}

Return ONLY JSON, no prose. EVERY step must have non-empty include AND exclude arrays (short, concrete, one line each):
{
  "semantic_query": "ONE well-formed natural-language research question (<=300 chars) capturing the study intent — a full sentence a semantic search engine can embed, NOT a keyword list",
  "step1": { "keywords": ["6-10 precise OpenAlex search terms/phrases"], "filters": { "fromYear": <int or null>, "oa": <bool>, "journals": <bool> }, "include": ["2-4 quick title/metadata-level inclusion criteria for fast screening"], "exclude": ["2-4 quick exclusion criteria (off-topic, wrong venue/type, etc.)"] },
  "step2": { "include": ["3-5 abstract-level inclusion criteria, one short line each"], "exclude": ["2-4 exclusion criteria"] },
  "step3": { "include": ["3-5 full-text inclusion criteria"], "exclude": ["2-4 exclusion criteria"], "signals": ["has_github","has_dataset"] }
}`;
  let out = '';
  try { out = await callClaude(model, '', prompt, false, 1800); } catch { return {}; }
  const m = out.match(/\{[\s\S]*\}/); if (!m) return {};
  try { return JSON.parse(m[0]); } catch { return {}; }
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
    const gate = await assertEntitled(sb, 'literature_study'); if (gate) return gate;
    const model = await resolveModel(sb);

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

    // ---------------- plan: Claude pre-fills the funnel config for every step (the user fine-tunes) ----------------
    if (action === 'plan') {
      const { data: proj } = await sb.from('research_projects').select('title,field,goal,keywords').eq('id', study.project_id).maybeSingle();
      const plan = await planStudy(study, proj || {}, model);
      for (const n of [1, 2, 3]) {
        const sp = plan['step' + n]; if (!sp || typeof sp !== 'object') continue;
        const { data: row } = await sb.from('research_study_steps').select('config').eq('study_id', study_id).eq('step', n).maybeSingle();
        const cur: any = (row && row.config) || {};
        const next: any = Object.assign({}, cur);
        if (n === 1 && Array.isArray(sp.keywords)) next.keywords = sp.keywords.slice(0, 12).map((k: any) => String(k));
        if (n === 1 && sp.filters && typeof sp.filters === 'object') next.filters = Object.assign({}, cur.filters || {}, sp.filters);
        if (Array.isArray(sp.include)) next.include = sp.include.slice(0, 8).map((k: any) => String(k));
        if (Array.isArray(sp.exclude)) next.exclude = sp.exclude.slice(0, 8).map((k: any) => String(k));
        if (Array.isArray(sp.signals)) next.signals = sp.signals.map((k: any) => String(k));
        await sb.from('research_study_steps').update({ config: next }).eq('study_id', study_id).eq('step', n);
      }
      // persist the natural-language semantic query into step-1 config — OUTSIDE the loop, so a good
      // semantic_query survives even if the model returned a malformed step1 (the loop would `continue` past it).
      if (typeof plan.semantic_query === 'string' && plan.semantic_query.trim()) {
        const { data: s1 } = await sb.from('research_study_steps').select('config').eq('study_id', study_id).eq('step', 1).maybeSingle();
        const c1: any = (s1 && s1.config) || {};
        c1.semantic_query = plan.semantic_query.trim().slice(0, 350);
        await sb.from('research_study_steps').update({ config: c1 }).eq('study_id', study_id).eq('step', 1);
      }
      return json({ ok: true });
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
      const maxResults = Math.min(400, parseInt(String(config.max_results || '200'), 10));
      let relaxed = false; let usedSource = 'openalex'; let elicitRate: any = null;
      // First call: fetch the papers once and create the unscreened candidate rows (idempotent —
      // ignoreDuplicates preserves any human-overridden/already-screened rows the run's delete kept).
      if (offset === 0) {
        const q = study.question || study.title;
        // natural-language query for SEMANTIC Elicit search: authored/planned semantic_query, else the study question
        const semanticQ = (config.semantic_query && String(config.semantic_query).trim()) || study.question || study.title || '';
        let u: any = null;
        // Elicit adapter (config.source_adapter = 'elicit' | 'elicit_keyword') — gated + budgeted + cached,
        // with a graceful OpenAlex fallback on any denial / rate-limit / quota / outage.
        if (String(config.source_adapter || '').indexOf('elicit') === 0) {
          const mode = config.source_adapter === 'elicit_keyword' ? 'keyword' : 'semantic';
          const { data: entOk } = await sb.rpc('is_feature_enabled', { p_key: 'elicit_search' });
          const cap = parseInt(Deno.env.get('ELICIT_SEARCH_DAILY') || '50', 10);
          const { data: over } = await sb.rpc('feature_over_budget', { p_key: 'elicit_search', max_calls: cap });
          if (entOk === true && over !== true) {
            // sq only affects semantic results → include it in the key ONLY in semantic mode (keyword mode is unaffected)
            const cacheKey = hashStr(JSON.stringify({ q, sq: mode === 'semantic' ? semanticQ : '', mode, corpus: config.corpus || 'elicit', f: config.filters || {}, mq: config.maxQuartile || '', kw: config.keywords || [], n: maxResults }));
            const { data: cached } = await sb.from('elicit_search_cache').select('results,ratelimit,fetched_at').eq('query_hash', cacheKey).maybeSingle();
            if (cached && cached.results && (Date.now() - new Date(cached.fetched_at).getTime() < 24 * 3600 * 1000)) {
              u = { papers: cached.results, relaxed: false }; usedSource = 'elicit'; elicitRate = cached.ratelimit || null;   // cache hit → free (no bump)
            } else {
              const er = await elicitSearch(q, config, maxResults, mode, semanticQ);
              elicitRate = er.rate;
              if (!er.error && er.papers.length) {
                u = { papers: er.papers, relaxed: false }; usedSource = 'elicit';
                await sb.rpc('feature_usage_bump', { p_key: 'elicit_search' });
                await sb.from('elicit_search_cache').upsert({ query_hash: cacheKey, query: String((mode === 'semantic' ? semanticQ : '') || q).slice(0, 300), corpus: config.corpus || 'elicit', search_mode: mode, filters: config.filters || {}, results: er.papers, ratelimit: er.rate, fetched_at: new Date().toISOString() });
              }
            }
          }
        }
        if (!u) u = await openalexUnion(q, config, maxResults);   // default path + Elicit fallback
        relaxed = !!u.relaxed;
        // Dedupe by ext_id BEFORE the upsert: a single duplicate ext_id in one batch makes the whole
        // onConflict upsert fail ("cannot affect row a second time") → 0 rows saved. OpenAlex already
        // dedupes; Elicit (and cached Elicit results) can contain a repeated DOI. Guards every adapter.
        const seenExt = new Set<string>();
        const found = (u.papers || []).filter((p: any) => { if (!p.ext_id || seenExt.has(p.ext_id)) return false; seenExt.add(p.ext_id); return true; });
        if (found.length) {
          const srcRows = found.map((p: any) => ({
            project_id: study.project_id, source_api: p.source || config.source_adapter || 'openalex', ext_id: p.ext_id,
            doi: p.doi, title: p.title, authors: (p.authors && p.authors.length) ? p.authors : null, year: p.year,
            venue: p.venue, abstract: p.abstract || null, cited_by: p.cited_by, url: p.url, oa_pdf_url: p.oa_pdf_url || null, issn: p.issn || null, screening: 'unscreened',
          }));
          const { data: ups } = await sb.from('research_sources').upsert(srcRows, { onConflict: 'project_id,ext_id' }).select('id,ext_id');
          const byExt: Record<string, string> = {}; (ups || []).forEach((r: any) => { byExt[r.ext_id] = r.id; });
          const spRows = found.map((p: any) => byExt[p.ext_id]).filter(Boolean).map((id: string) => ({ study_id, source_id: id, step: 1, decision: 'unscreened' }));
          if (spRows.length) await sb.from('research_study_papers').upsert(spRows, { onConflict: 'study_id,source_id,step', ignoreDuplicates: true });
        }
      }
      // Screen the next `limit` UNSCREENED step-1 candidates (join sources for title/abstract). Same response
      // shape as before → the browser's batch loop is unchanged; it just iterates the union instead of pages.
      const { data: pend } = await sb.from('research_study_papers').select('source_id').eq('study_id', study_id).eq('step', 1).eq('decision', 'unscreened').eq('overridden', false).order('source_id').limit(limit);
      const pendIds = (pend || []).map((x: any) => x.source_id);
      let results: any[] = [];
      if (pendIds.length) {
        const { data: srcs } = await sb.from('research_sources').select('id,title,year,venue,abstract,url,doi,oa_pdf_url').in('id', pendIds);
        const inputs = (srcs || []).map((s: any) => ({ source_id: s.id, title: s.title, year: s.year, venue: s.venue, abstract: s.abstract, url: s.url, doi: s.doi, oa_pdf_url: s.oa_pdf_url }));
        results = await screenAndWrite(sb, study, study_id, 1, config, model, inputs, false);
      }
      const { count: stepTotal } = await sb.from('research_study_papers').select('source_id', { count: 'exact', head: true }).eq('study_id', study_id).eq('step', 1);
      const total_count = await recount(sb, study_id, 1);
      const screenedNow = pendIds.length;
      const nextOffset = offset + screenedNow;
      const done = screenedNow < limit;   // fewer than a full batch of unscreened left → finished
      await finishBatch(sb, study_id, 1, nextOffset, stepTotal || 0, done);
      return json({ ok: true, step: 1, fetched: stepTotal || 0, new_sources: offset === 0 ? (stepTotal || 0) : 0, counts: total_count, results, next_offset: nextOffset, done, total_estimate: stepTotal || 0, relaxed, source: usedSource, elicit_rate: elicitRate });
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
  const sys = screenSystem(study.question || study.title, config, step);
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
    if (d.criteria && typeof d.criteria === 'object') signals.criteria = { inc: (d.criteria.inc || []).slice(0, 6).map((x: any) => String(x).slice(0, 80)), exc: (d.criteria.exc || []).slice(0, 6).map((x: any) => String(x).slice(0, 80)) };
    if (d.extract && typeof d.extract === 'object') signals.extract = { method: String(d.extract.method || '').slice(0, 160), dataset: String(d.extract.dataset || '').slice(0, 120), finding: String(d.extract.finding || '').slice(0, 200) };
    // score column is INT — coerce to an integer 0–100 (and rescale a 0–1 fraction up), else the upsert
    // silently fails and the whole batch writes nothing
    let sc: number | null = null;
    if (typeof d.score === 'number' && !isNaN(d.score)) { let v = (d.score > 0 && d.score <= 1) ? d.score * 100 : d.score; sc = Math.round(Math.max(0, Math.min(100, v))); }
    await sb.from('research_study_papers').upsert({ study_id, source_id: p.source_id, step, decision, reason: (d.reason || '').slice(0, 500), score: sc, signals, overridden: false }, { onConflict: 'study_id,source_id,step' });
    out.push({ source_id: p.source_id, title: p.title, decision, reason: d.reason || '', score: sc, signals });
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
