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
async function resolveOa(doi: string): Promise<{ url: string | null; source: string }> {
  const ax = arxivPdf(doi);
  if (ax) return { url: ax, source: 'arxiv' };
  const d = bareDoi(doi);
  if (!d) return { url: null, source: 'none' };
  try {
    const u = 'https://api.openalex.org/works/doi:' + encodeURIComponent(d) + (OA_KEY ? '?api_key=' + OA_KEY : '');
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (r.ok) {
      const w = await r.json();
      const cands = [w?.best_oa_location?.pdf_url, w?.primary_location?.pdf_url, w?.open_access?.oa_url,
      ...((w?.locations || []).map((l: any) => l?.pdf_url))].filter(Boolean);
      if (cands.length) return { url: cands[0], source: 'openalex' };
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
      return json({ ok: true, pdf_url: r.url, source: r.source, no_oa: !r.url });
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
