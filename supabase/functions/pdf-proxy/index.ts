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
async function resolveOa(doi: string): Promise<{ url: string | null; urls?: string[]; source: string; abstract?: string | null; matched_title?: string | null; failed?: boolean }> {
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
    if (r.status !== 404) return { url: null, source: 'none', failed: true };   // 404 = genuinely unknown DOI
  } catch (_e) { return { url: null, source: 'none', failed: true }; }
  return { url: null, source: 'none' };
}
// Many MTMT records carry no DOI, so a title lookup is the only way to reach the open-access copy. The title
// match is deliberately STRICT: attaching the wrong paper as the conversation's context is far worse than
// finding nothing, and OpenAlex's search happily returns loose matches.
function normTitle(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
async function resolveByTitle(title: string, year?: number): Promise<{ url: string | null; urls?: string[]; source: string; matched_title?: string | null; doi?: string | null; abstract?: string | null; failed?: boolean }> {
  const t = String(title || '').trim().slice(0, 300);
  if (normTitle(t).length < 15) return { url: null, source: 'none' };
  try {
    const filters = ['title.search:' + t.replace(/[,:;()\[\]]/g, ' ')];
    const y = Number(year);
    if (Number.isFinite(y) && y > 1800) filters.push('publication_year:' + (y - 1) + '|' + y + '|' + (y + 1));   // online-first vs print year
    const u = 'https://api.openalex.org/works?filter=' + encodeURIComponent(filters.join(',')) + '&per-page=5' + (OA_KEY ? '&api_key=' + OA_KEY : '');
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!r.ok) return { url: null, source: 'none', failed: true };   // upstream problem — NOT "no open access"
    const d = await r.json();
    const want = normTitle(t);
    let fallback: { url: null; source: string; matched_title: string | null; doi: string | null; abstract: string | null } | null = null;
    for (const w of ((d && d.results) || [])) {
      const got = normTitle(w?.display_name || w?.title);
      if (!got) continue;
      // A 45-char prefix match used to be enough — far too loose for "Deep learning for …" style titles.
      // Now: exact, or one title is a PREFIX of the other (sub-title differences) AND the shorter one is at
      // least 60% of the longer, so the distinguishing part cannot be the discarded half.
      const shorter = got.length < want.length ? got : want;
      const longer = got.length < want.length ? want : got;
      const strong = got === want || (longer.indexOf(shorter) === 0 && shorter.length >= 25 && shorter.length >= longer.length * 0.6);
      if (!strong) continue;
      const cands = pdfCandidates(w);
      const abs = abstractFrom(w);
      if (cands.length) return { url: cands[0], urls: cands, source: 'openalex-title', matched_title: w?.display_name || w?.title || null, doi: w?.doi || null, abstract: abs };
      // remember it, but keep scanning: a duplicate record further down the list may carry the open-access PDF
      if (abs && !fallback) fallback = { url: null, source: 'none', matched_title: w?.display_name || w?.title || null, doi: w?.doi || null, abstract: abs };
    }
    if (fallback) return fallback;
  } catch (_e) { return { url: null, source: 'none', failed: true }; }
  return { url: null, source: 'none' };
}
function safeUrl(u: string): boolean {
  try {
    const p = new URL(u);
    if (p.protocol !== 'https:') return false;                      // https ONLY (the comment always said so)
    const host = p.hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
    if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (host === '::1' || host === '::' || /^fc|^fd/.test(host) || /^fe[89ab]/.test(host)) return false;   // IPv6 loopback / ULA / link-local
    if (host.indexOf('::ffff:') === 0) return false;                 // IPv4-mapped IPv6
    // Numeric hosts: normalise decimal/octal/hex forms before range-checking, so http://2130706433/ cannot slip through.
    const dotted = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    let ip: number[] | null = null;
    if (dotted) ip = [+dotted[1], +dotted[2], +dotted[3], +dotted[4]];
    else if (/^(0x[0-9a-f]+|0[0-7]*|\d+)$/.test(host)) {
      const n = host.indexOf('0x') === 0 ? parseInt(host, 16) : (/^0[0-7]+$/.test(host) ? parseInt(host, 8) : parseInt(host, 10));
      if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff) ip = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
      else return false;
    }
    if (ip) {
      if (ip.some((o) => !Number.isFinite(o) || o < 0 || o > 255)) return false;
      const [a, b] = ip;
      if (a === 0 || a === 10 || a === 127) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;            // CGNAT
      if (a >= 224) return false;                                    // multicast / reserved
    }
    return true;
  } catch (_e) { return false; }
}
// Follow redirects OURSELVES so every hop is validated — `redirect:'follow'` only checked the first URL.
async function safeFetch(target: string, maxHops = 3): Promise<Response | { blocked: true }> {
  let url = target;
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!safeUrl(url)) return { blocked: true };
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/pdf,*/*' }, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return r;
      try { url = new URL(loc, url).toString(); } catch { return { blocked: true }; }
      try { await r.body?.cancel(); } catch { /* ignore */ }
      continue;
    }
    return r;
  }
  return { blocked: true };
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
      let lookupFailed = !!r.failed;
      // No DOI (or the DOI led nowhere) → try the title. Backwards compatible: callers that pass only a doi
      // get exactly the old behaviour plus an abstract when OpenAlex has one.
      const t = String(body.title || '');
      if (t) {
        const r2 = await resolveByTitle(t, Number(body.year));
        if (r2.url || r2.abstract) return json({ ok: true, pdf_url: r2.url, pdf_urls: r2.urls || (r2.url ? [r2.url] : []), source: r2.url ? r2.source : 'none', matched_title: r2.matched_title || null, doi: r2.doi || null, abstract: r2.abstract || null, no_oa: !r2.url, lookup_failed: false });
        if (r2.failed) lookupFailed = true;
      }
      // no_oa means "we looked and there is no open-access copy". If the lookup itself failed, say THAT — the
      // caller must not record a transient outage as a permanent "no open access".
      return json({ ok: true, pdf_url: null, pdf_urls: [], source: 'none', abstract: r.abstract || null, matched_title: r.matched_title || null, no_oa: !lookupFailed, lookup_failed: lookupFailed });
    }

    if (action === 'fetch') {
      const target = String(body.url || '');
      if (!safeUrl(target)) return json({ error: 'bad url' }, 400);
      const rr = await safeFetch(target);
      if ((rr as any).blocked) return json({ error: 'bad url' }, 400);
      const r = rr as Response;
      if (!r.ok) return json({ error: 'could not fetch pdf', status: r.status }, 502);
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      const MAX = 40 * 1024 * 1024;
      const declared = parseInt(r.headers.get('content-length') || '', 10);
      if (Number.isFinite(declared) && declared > MAX) { try { await r.body?.cancel(); } catch { /* ignore */ } return json({ error: 'pdf too large' }, 413); }
      // stream with a running byte count: a 500 MB body must not be buffered just to be rejected afterwards
      const chunks: Uint8Array[] = []; let total = 0;
      const reader = r.body?.getReader();
      if (!reader) return json({ error: 'could not fetch pdf' }, 502);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX) { try { await reader.cancel(); } catch { /* ignore */ } return json({ error: 'pdf too large' }, 413); }
          chunks.push(value);
        }
      }
      const buf = new Uint8Array(total); let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
      // must look like a PDF (magic %PDF)
      const isPdf = buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
      if (!isPdf && ct.indexOf('pdf') < 0) return json({ error: 'not a pdf' }, 415);
      return new Response(buf, { headers: { ...CORS, 'Content-Type': 'application/pdf', 'Cache-Control': 'private, max-age=3600' } });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (_e) {
    return json({ error: 'Internal error' }, 500);
  }
});
