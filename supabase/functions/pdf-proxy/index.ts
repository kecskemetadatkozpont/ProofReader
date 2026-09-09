// pdf-proxy — Figure Board pipeline (P0):
//   resolve  {doi}       → find the open-access PDF URL (arXiv shortcut, else OpenAlex best_oa_location)
//   fetch    {url}       → download the PDF server-side (bypass CORS) and stream the bytes back to pdf.js
// Gated to active users. `fetch` guards against SSRF (https only, no private hosts, capped size).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertActive } from '../_shared/entitlement.ts';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const OA_KEY = Deno.env.get('OPENALEX_API_KEY') || '';
const UA = 'Mozilla/5.0 (Publify FigureBoard; mailto:kecskemet.adatkozpont@gmail.com)';
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

function bareDoi(d: string): string {
  return String(d || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, '').trim();
}
// arXiv DOIs look like 10.48550/arXiv.2010.03759 → PDF at https://arxiv.org/pdf/2010.03759
function arxivPdf(doi: string): string | null {
  const m = bareDoi(doi).match(/arxiv\.([0-9]{4}\.[0-9]{4,5}(v\d+)?)/i) || bareDoi(doi).match(/arxiv\.([a-z-]+\/\d{7})/i);
  return m ? 'https://arxiv.org/pdf/' + m[1] : null;
}
// OpenAlex ships abstracts as an inverted index (term -> positions); rebuild the running text.
function abstractFrom(w: any): string | null {
  const inv = w && w.abstract_inverted_index;
  if (!inv || typeof inv !== 'object') return null;
  const words: string[] = [];
  for (const term of Object.keys(inv)) for (const pos of (inv[term] || [])) words[pos] = term;
  const out = words.filter((x) => x != null).join(' ').replace(/\s+/g, ' ').trim();
  return out ? out.slice(0, 4000) : null;
}
function pdfCandidates(w: any): string[] {
  const raw = [w?.best_oa_location?.pdf_url, w?.primary_location?.pdf_url,
  ...((w?.locations || []).map((l: any) => l?.pdf_url)), w?.open_access?.oa_url];   // oa_url LAST: often a landing page
  const seen: Record<string, boolean> = {}; const out: string[] = [];
  for (const u of raw) { const v = String(u || '').trim(); if (v && !seen[v]) { seen[v] = true; out.push(v); } }
  return out;
}
async function resolveOa(doi: string): Promise<{ url: string | null; urls?: string[]; source: string; abstract?: string | null; matched_title?: string | null }> {
  const ax = arxivPdf(doi);
  if (ax) return { url: ax, urls: [ax], source: 'arxiv' };
  const d = bareDoi(doi);
  if (!d) return { url: null, source: 'none' };
  try {
    const u = 'https://api.openalex.org/works/doi:' + encodeURIComponent(d) + (OA_KEY ? '?api_key=' + OA_KEY : '');
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (r.ok) {
      const w = await r.json();
      const abs = abstractFrom(w);
      const cands = pdfCandidates(w);
      // the abstract is returned even when there is no PDF — it is the fallback context
      if (cands.length) return { url: cands[0], urls: cands, source: 'openalex', abstract: abs, matched_title: w?.display_name || null };
      return { url: null, urls: [], source: 'none', abstract: abs, matched_title: w?.display_name || null };
    }
  } catch (_e) { /* fall through */ }
  return { url: null, source: 'none' };
}
// Many MTMT records carry no DOI, so a title lookup is the only way to reach the open-access copy. The title
// match is deliberately STRICT: attaching the wrong paper as the conversation's context is far worse than
// finding nothing, and OpenAlex's search happily returns loose matches.
function normTitle(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
async function resolveByTitle(title: string, year?: number): Promise<{ url: string | null; urls?: string[]; source: string; matched_title?: string | null; doi?: string | null; abstract?: string | null }> {
  const t = String(title || '').trim().slice(0, 300);
  if (normTitle(t).length < 15) return { url: null, source: 'none' };
  try {
    const filters = ['title.search:' + t.replace(/[,:;()\[\]]/g, ' ')];
    if (Number.isFinite(year as number) && (year as number) > 1800) filters.push('publication_year:' + year);
    const u = 'https://api.openalex.org/works?filter=' + encodeURIComponent(filters.join(',')) + '&per-page=5' + (OA_KEY ? '&api_key=' + OA_KEY : '');
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!r.ok) return { url: null, source: 'none' };
    const d = await r.json();
    const want = normTitle(t);
    for (const w of ((d && d.results) || [])) {
      const got = normTitle(w?.display_name || w?.title);
      if (!got) continue;
      const strong = got === want
        || (want.length > 30 && (got.indexOf(want) === 0 || want.indexOf(got) === 0))   // sub/super-title differences only
        || (got.length > 30 && want.length > 30 && got.slice(0, 45) === want.slice(0, 45));
      if (!strong) continue;
      const cands = pdfCandidates(w);
      const abs = abstractFrom(w);
      if (cands.length) return { url: cands[0], urls: cands, source: 'openalex-title', matched_title: w?.display_name || w?.title || null, doi: w?.doi || null, abstract: abs };
      if (abs) return { url: null, source: 'none', matched_title: w?.display_name || w?.title || null, doi: w?.doi || null, abstract: abs };
    }
  } catch (_e) { /* fall through */ }
  return { url: null, source: 'none' };
}
function safeUrl(u: string): boolean {
  try {
    const p = new URL(u);
    if (p.protocol !== 'https:' && p.protocol !== 'http:') return false;
    const host = p.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host === '127.0.0.1' || host === '0.0.0.0') return false;
    if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
    return true;
  } catch (_e) { return false; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const sb = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: ures } = await sb.auth.getUser();
    if (!ures?.user?.id) return json({ error: 'unauthenticated' }, 401);
    const gate = await assertActive(sb); if (gate) return gate;   // active account only

    const body = await req.json().catch(() => ({} as any));
    const action = String(body.action || '');

    if (action === 'resolve') {
      const r = await resolveOa(String(body.doi || ''));
      if (r.url) return json({ ok: true, pdf_url: r.url, pdf_urls: r.urls || [r.url], source: r.source, abstract: r.abstract || null, matched_title: r.matched_title || null, no_oa: false });
      // No DOI (or the DOI led nowhere) → try the title. Backwards compatible: callers that pass only a doi
      // get exactly the old behaviour plus an abstract when OpenAlex has one.
      const t = String(body.title || '');
      if (t) {
        const r2 = await resolveByTitle(t, Number(body.year));
        if (r2.url || r2.abstract) return json({ ok: true, pdf_url: r2.url, pdf_urls: r2.urls || (r2.url ? [r2.url] : []), source: r2.url ? r2.source : 'none', matched_title: r2.matched_title || null, doi: r2.doi || null, abstract: r2.abstract || null, no_oa: !r2.url });
      }
      return json({ ok: true, pdf_url: null, pdf_urls: [], source: 'none', abstract: r.abstract || null, no_oa: true });
    }

    if (action === 'fetch') {
      const target = String(body.url || '');
      if (!safeUrl(target)) return json({ error: 'bad url' }, 400);
      const r = await fetch(target, { headers: { 'User-Agent': UA, 'Accept': 'application/pdf,*/*' }, redirect: 'follow' });
      if (!r.ok) return json({ error: 'could not fetch pdf', status: r.status }, 502);
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      const buf = new Uint8Array(await r.arrayBuffer());
      // must look like a PDF (magic %PDF), and be within a sane size
      const isPdf = buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
      if (!isPdf && ct.indexOf('pdf') < 0) return json({ error: 'not a pdf' }, 415);
      if (buf.length > 40 * 1024 * 1024) return json({ error: 'pdf too large' }, 413);
      return new Response(buf, { headers: { ...CORS, 'Content-Type': 'application/pdf', 'Cache-Control': 'private, max-age=3600' } });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (_e) {
    return json({ error: 'Internal error' }, 500);
  }
});
