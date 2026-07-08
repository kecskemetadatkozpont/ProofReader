import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = 'claude-haiku-4-5-20251001';
const PDF_MAX = 4 * 1024 * 1024;   // edge isolate OOMs (HTTP 546) base64-ing + sending larger PDFs to Claude; bigger ones fall back to the abstract
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
async function callClaude(system: string, content: any, maxTokens: number) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }) });
  const o = await r.json(); if (o.error) throw new Error(o.error.message || 'anthropic');
  return (o.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
}
async function fetchPdfBlock(url: string): Promise<any | null> {
  if (!url) return null;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 14000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Publify/1.0', 'Range': 'bytes=0-' + (PDF_MAX - 1) } }); clearTimeout(t);
    if (!r.ok || !r.body) { try { await r.body?.cancel(); } catch (e) { } return null; }
    const ct = r.headers.get('content-type') || '';
    if (!/pdf/i.test(ct) && !/\.pdf($|\?)/i.test(url)) { try { await r.body.cancel(); } catch (e) { } return null; }
    const clen = parseInt(r.headers.get('content-length') || '0', 10);
    if (clen && clen > PDF_MAX) { try { await r.body.cancel(); } catch (e) { } return null; }
    // STREAM with a hard size cap — a huge PDF (incl. chunked / redirected, where content-length is absent) would
    // otherwise OOM the isolate (HTTP 546) when arrayBuffer() loads it all. Stop + bail the moment we exceed the cap.
    const reader = r.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { total += value.length; if (total > PDF_MAX) { try { await reader.cancel(); } catch (e) { } return null; } chunks.push(value); }
    }
    if (!total) return null;
    const buf = new Uint8Array(total); let off = 0; for (const c of chunks) { buf.set(c, off); off += c.length; }
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: encodeBase64(buf) } };   // native base64 (the old per-byte concat was O(n²))
  } catch { return null; }
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: ures } = await sb.auth.getUser();
    if (!ures || !ures.user) return json({ error: 'unauthorized' }, 401);
    // per-user daily AI budget (no-op until migration-48 is applied)
    const { data: over } = await sb.rpc('ai_over_budget', { max_calls: parseInt(Deno.env.get('AI_DAILY_CALLS') || '200', 10) });
    if (over === true) return json({ error: 'Daily AI limit reached — please try again tomorrow.' }, 429);
    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode || 'translate');

    // (a) flowing literature OVERVIEW for an audiobook, written directly in the target language
    if (mode === 'summarize') {
      const papers = (Array.isArray(body.papers) ? body.papers : []).slice(0, 30);
      const target = String(body.target_lang || 'English');
      if (!papers.length) return json({ text: '' });
      const list = papers.map((p: any, i: number) => `[${i + 1}] ${String(p.title || '').slice(0, 240)}\nAbstract: ${String(p.abstract || '(none)').slice(0, 1200)}`).join('\n\n');
      const n = Math.min(70, 14 + papers.length * 4);
      const sys = `You are writing the SCRIPT for a spoken literature-overview audiobook, in ${target}. You are given ${papers.length} papers (title + abstract). Write flowing, connected narration in ${target}: open with one or two framing sentences about the topic, then weave each paper's key contribution / method / finding into natural connected prose. NO bullet points, NO headings, NO citation markers like [12], NO "Paper 1:". Spell out unavoidable abbreviations naturally. Aim for about ${n} sentences, suitable to be read aloud. Output ONLY the narration text.`;
      const text = await callClaude(sys, list, 4000); sb.rpc('ai_usage_bump');
      return json({ text });
    }

    // (b) clean full-text reading copy extracted from an OA PDF
    if (mode === 'fulltext') {
      const url = String(body.url || '');
      const pdf = await fetchPdfBlock(url);
      if (!pdf) return json({ text: '', note: 'no_pdf' });
      const sys = `Extract the clean READING TEXT (main body: introduction, methods, results, discussion, conclusion) from this paper so it can be read aloud as an audiobook. SKIP the references/bibliography list, figure and table captions, author affiliations, headers/footers, page numbers, and standalone equations that do not read aloud. Keep the paper's original language. Return ONLY the readable prose — no preamble.`;
      const text = await callClaude(sys, [pdf, { type: 'text', text: 'Return the clean reading text now.' }], 8000); sb.rpc('ai_usage_bump');
      return json({ text });
    }

    // default: TRANSLATE a batch of segments
    const segments = Array.isArray(body.segments) ? body.segments.map((x: any) => String(x || '').slice(0, 2000)) : [];   // per-segment length cap bounds token cost
    const target = String(body.target_lang || 'English');
    const source = body.source_lang ? String(body.source_lang) : '';
    if (!segments.length) return json({ segments: [] });
    if (segments.length > 60) return json({ error: 'too many segments (max 60 per call)' }, 400);
    const sys = `You are a professional academic translator. Translate each input text segment ${source ? 'from ' + source + ' ' : ''}into ${target}. Preserve scientific terminology, units, equations, and proper nouns; produce natural, fluent ${target} suitable for AUDIOBOOK narration (no markup, no citations like [12], spell out unavoidable abbreviations naturally). Return ONLY a JSON array of EXACTLY ${segments.length} strings, in the SAME order — no preamble, no object keys.`;
    const out = await callClaude(sys, 'Segments (JSON array of strings):\n' + JSON.stringify(segments), 8000); sb.rpc('ai_usage_bump');
    let arr: any = [];
    const m = out.match(/\[[\s\S]*\]/); if (m) { try { arr = JSON.parse(m[0]); } catch (e) { /* fall through */ } }
    if (!Array.isArray(arr) || arr.length !== segments.length) return json({ error: 'translation_parse_failed', raw: out.slice(0, 200) }, 502);
    return json({ segments: arr.map((x: any) => String(x || '')) });
  } catch (e) { return json({ error: String(e) }, 500); }
});
