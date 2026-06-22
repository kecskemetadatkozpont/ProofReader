// Publify — Paper Figure Edge Function (PaperBanana integration).
// Generates publication-quality figures from a method-section text + a caption. Proxies to a self-hosted
// PaperBanana service when PAPERBANANA_ENDPOINT is set; otherwise returns SVG PLACEHOLDER candidates so the
// whole UI + insert flow works end-to-end without the external service. Gated per-user (profiles.can_figures).
//
// Deploy:  supabase functions deploy paper-figure --no-verify-jwt
// Secrets: supabase secrets set PAPERBANANA_ENDPOINT=https://<your-paperbanana-host>   (optional → live mode)
//          supabase secrets set PAPERBANANA_TOKEN=<shared bearer>                       (optional)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ENDPOINT = (Deno.env.get('PAPERBANANA_ENDPOINT') || '').replace(/\/$/, '');
const PB_TOKEN = Deno.env.get('PAPERBANANA_TOKEN') || '';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

function esc(s: string) { return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c]); }
function wrap(text: string, max: number): string[] {
  const words = String(text || 'Figure').split(/\s+/); const lines: string[] = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > max) { if (cur) lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur); return lines.slice(0, 5);
}
function placeholderSvg(caption: string, i: number): string {
  const pal = ['#6366f1', '#0e9f6e', '#d9760b', '#db2777', '#0891b2'][i % 5];
  const lines = wrap(caption, 40);
  const h = 320 + lines.length * 18;
  const cap = lines.map((l, k) => `<text x="260" y="${268 + k * 18}" text-anchor="middle" font-size="12.5" fill="#5b6473">${esc(l)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="${h}" viewBox="0 0 520 ${h}">`
    + `<rect width="100%" height="100%" fill="#ffffff"/><rect x="0.5" y="0.5" width="519" height="${h - 1}" fill="none" stroke="#e6e8ee"/>`
    + `<defs><marker id="m${i}" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="${pal}"/></marker></defs>`
    + `<g stroke="${pal}" stroke-width="2" fill="none">`
    + `<rect x="55" y="55" width="120" height="58" rx="9"/><rect x="345" y="55" width="120" height="58" rx="9"/><rect x="200" y="160" width="120" height="58" rx="9"/>`
    + `<path d="M175 84 H345" marker-end="url(#m${i})"/><path d="M115 113 L240 160" marker-end="url(#m${i})"/><path d="M405 113 L300 160" marker-end="url(#m${i})"/></g>`
    + `<text x="115" y="89" text-anchor="middle" font-size="12" fill="#333">Input</text>`
    + `<text x="405" y="89" text-anchor="middle" font-size="12" fill="#333">Output</text>`
    + `<text x="260" y="194" text-anchor="middle" font-size="12" fill="#333">Method ${i + 1}</text>`
    + `<text x="260" y="238" text-anchor="middle" font-size="11" fill="${pal}" font-weight="700">PaperBanana — placeholder (candidate ${i + 1})</text>`
    + cap + `</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: ures } = await sb.auth.getUser();
    const uid = (ures && ures.user && ures.user.id) || '';
    if (!uid) return json({ error: 'auth required' }, 401);
    const { data: prof } = await sb.from('profiles').select('can_figures').eq('id', uid).maybeSingle();
    if (!prof || !prof.can_figures) return json({ error: 'Az ábra-generálás nincs engedélyezve ehhez a felhasználóhoz (admin-kapcsoló).' }, 403);

    const body = await req.json().catch(() => ({}));
    const method = String(body.method || '').slice(0, 20000);
    const caption = String(body.caption || '').slice(0, 600);
    const task = body.task === 'plot' ? 'plot' : 'diagram';
    const n = Math.max(1, Math.min(8, parseInt(String(body.n || '4'), 10)));
    if (!caption && !method) return json({ error: 'Adj meg method-szöveget vagy caption-t.' }, 400);

    if (ENDPOINT) {
      const r = await fetch(ENDPOINT + '/figure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(PB_TOKEN ? { Authorization: 'Bearer ' + PB_TOKEN } : {}) },
        body: JSON.stringify({ method, caption, task, n, mode: body.mode || 'dev_full' }),
      });
      if (!r.ok) return json({ error: 'PaperBanana service: ' + r.status + ' — ' + (await r.text()).slice(0, 300) }, 502);
      const out = await r.json();
      return json({ ok: true, mode: 'live', candidates: out.candidates || [], trace: out.trace || null });
    }

    const candidates = Array.from({ length: n }, (_, i) => ({ mime: 'image/svg+xml', dataUrl: placeholderSvg(caption, i), label: 'Jelölt ' + (i + 1) }));
    return json({ ok: true, mode: 'placeholder', candidates, note: 'PAPERBANANA_ENDPOINT nincs beállítva — placeholder ábrák. Állítsd be a secretet a valódi PaperBanana-generáláshoz.' });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
