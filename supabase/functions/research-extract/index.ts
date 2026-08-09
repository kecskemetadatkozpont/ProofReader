// Publify — Research Extract Edge Function (Elicit-style question-based data extraction).
// The AI seam ONLY: the client owns CRUD on research_extraction_questions/_cells (RLS); this edge answers ONE cell.
//
// Action:
//   run_cell {question_id, source_id}  → load the question + source, ground the answer in the OA full-text (PDF as a
//     Claude document block, which also carries the figures) with abstract fallback, and upsert the cell with a
//     VERBATIM quote + location + confidence. If the source does not support an answer → status 'na' (never invents).
//
// Deploy:  supabase functions deploy research-extract --no-verify-jwt   (or --use-api when Docker is down)
// Secrets: ANTHROPIC_API_KEY (reused).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertEntitled, clampModel } from '../_shared/entitlement.ts';
import { langDirective, loadProjectLang } from '../_shared/lang.ts';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const PDF_MAX_BYTES = 14 * 1024 * 1024;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// OA PDF → Claude document block (base64). Claude reads BOTH the text and the rendered figures of the PDF.
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

async function callClaude(model: string, system: string, content: any, maxTokens: number): Promise<string> {
  const headers: Record<string, string> = { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  const body = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] };
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  const o = await r.json();
  if (o.error) throw new Error(o.error.message || 'anthropic');
  return (o.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
}
function parseObj(text: string): any {
  const m = text.match(/\{[\s\S]*\}/); if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function typeHint(t: string): string {
  switch (t) {
    case 'number': return 'A NUMBER (with its unit if any), e.g. "10,000 cycles" or "0.91". If a range, give it.';
    case 'bool': return 'EXACTLY "Igen" or "Nem" (yes/no), optionally with a short qualifier.';
    case 'enum': return 'ONE short category label.';
    case 'list': return 'a short comma-separated list.';
    default: return 'a concise phrase (<= 20 words).';
  }
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503);
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: ures } = await sb.auth.getUser();
    if (!ures || !ures.user) return json({ error: 'unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'run_cell');

    if (action === 'run_cell') {
      const questionId = String(body.question_id || '');
      const sourceId = String(body.source_id || '');
      if (!questionId || !sourceId) return json({ error: 'question_id and source_id required' }, 400);

      const { data: q } = await sb.from('research_extraction_questions').select('id,project_id,text,answer_type,source_mode').eq('id', questionId).maybeSingle();
      if (!q) return json({ error: 'question not found or no access' }, 404);
      const gate = await assertEntitled(sb, 'literature_study'); if (gate) return gate;
      const { data: src } = await sb.from('research_sources').select('id,title,year,venue,abstract,url,doi,oa_pdf_url').eq('id', sourceId).maybeSingle();
      if (!src) return json({ error: 'source not found or no access' }, 404);

      const model = await clampModel(sb, 'claude-sonnet-4-6');   // grounding + PDF/figure reading → prefer sonnet, fall back to the user's allowed model
      const _lang = await loadProjectLang(sb, q.project_id);
      const wantFig = q.source_mode === 'figures' || q.source_mode === 'both';
      const wantText = q.source_mode !== 'figures';

      // ground the answer: OA PDF (text + figures) when available, else abstract
      let pdfBlock: any = null;
      if (wantText || wantFig) pdfBlock = await fetchPdfBlock(src.oa_pdf_url || src.url);
      const basis = pdfBlock ? 'pdf' : 'abstract';

      const sys = `You extract ONE piece of information from ONE research paper for a systematic review data-extraction table, and you GROUND every answer in the paper. Never invent facts.
Return ONLY a JSON object (no prose):
{"found": true|false,
 "answer": "<the answer — ${typeHint(q.answer_type)}>",
 "quote": "<a VERBATIM sentence/phrase copied from the paper that directly supports the answer — max 240 chars>",
 "page": <page number as an integer, or null>,
 "section": "<section/heading label, or empty>",
 "figure": "<figure/table label if the evidence is a figure/table, e.g. 'Figure 4', else empty>",
 "confidence": "high|mid"}
Rules:
- "found": false ONLY if the paper does NOT contain evidence for the question. Then leave answer/quote empty.
- The "quote" MUST be text that actually appears in the paper (verbatim). If the evidence is a figure, quote its caption or the relevant axis/label text.
- ${wantFig ? 'If the question targets a figure/plot/table, READ the figures in the attached PDF and cite the figure.' : 'Prefer textual evidence.'}
- confidence "high" only when the evidence is explicit and unambiguous; otherwise "mid".` + langDirective(_lang);

      const content: any[] = [{
        type: 'text',
        text: `QUESTION: ${q.text}\n\nPAPER:\nTitle: ${src.title || ''}\nYear: ${src.year || ''}  Venue: ${src.venue || ''}\n`
          + (pdfBlock ? '(full-text PDF attached below — read its text AND figures)' : ('Abstract: ' + (src.abstract || '(no abstract available)')))
          + `\n\nExtract the answer for the QUESTION now, grounded in this paper. Return ONLY the JSON object.`,
      }];
      if (pdfBlock) content.push(pdfBlock);

      let parsed: any = null;
      try { parsed = parseObj(await callClaude(model, sys, content, 900)); } catch (e) { parsed = null; }

      const nowIso = new Date().toISOString();
      const fingerprint = await sha256([q.text, sourceId, model, q.source_mode].join('|'));
      let row: any;
      if (!parsed) {
        row = { answer: null, quote: null, location: { basis }, confidence: 'na', status: 'error', error: 'AI nem adott értelmezhető választ', model, fingerprint, updated_at: nowIso };
      } else if (!parsed.found) {
        row = { answer: null, quote: null, location: { basis }, confidence: 'na', status: 'na', error: null, model, fingerprint, updated_at: nowIso };
      } else {
        row = {
          answer: String(parsed.answer || '').slice(0, 600),
          quote: String(parsed.quote || '').slice(0, 300),
          location: { basis, page: (typeof parsed.page === 'number' ? parsed.page : null), section: String(parsed.section || '').slice(0, 120), figure: String(parsed.figure || '').slice(0, 60) },
          confidence: (parsed.confidence === 'high' ? 'high' : 'mid'),
          status: 'done', error: null, model, fingerprint, updated_at: nowIso,
        };
      }
      // upsert the cell (unique on question_id+source_id)
      const { data: up, error: upErr } = await sb.from('research_extraction_cells')
        .upsert(Object.assign({ question_id: questionId, source_id: sourceId, project_id: q.project_id }, row), { onConflict: 'question_id,source_id' })
        .select('*').maybeSingle();
      if (upErr) return json({ error: 'cell save failed: ' + upErr.message }, 500);
      return json({ ok: true, cell: up, basis });
    }

    return json({ error: 'unknown action: ' + action }, 400);
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
