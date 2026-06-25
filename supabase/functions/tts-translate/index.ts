import { createClient } from 'jsr:@supabase/supabase-js@2';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = 'claude-haiku-4-5-20251001';
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
async function callClaude(system: string, content: string, maxTokens: number) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }) });
  const o = await r.json(); if (o.error) throw new Error(o.error.message || 'anthropic');
  return (o.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503);
    // RLS gate: require a valid user (the function runs with the caller's JWT)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: ures } = await sb.auth.getUser();
    if (!ures || !ures.user) return json({ error: 'unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const segments = Array.isArray(body.segments) ? body.segments.map((x: any) => String(x || '')) : [];
    const target = String(body.target_lang || 'English');
    const source = body.source_lang ? String(body.source_lang) : '';
    if (!segments.length) return json({ segments: [] });
    if (segments.length > 60) return json({ error: 'too many segments (max 60 per call)' }, 400);
    const sys = `You are a professional academic translator. Translate each input text segment ${source ? 'from ' + source + ' ' : ''}into ${target}. Preserve scientific terminology, units, equations, and proper nouns; produce natural, fluent ${target} suitable for AUDIOBOOK narration (no markup, no citations like [12], spell out unavoidable abbreviations naturally). Return ONLY a JSON array of EXACTLY ${segments.length} strings, in the SAME order — no preamble, no object keys.`;
    const out = await callClaude(sys, 'Segments (JSON array of strings):\n' + JSON.stringify(segments), 8000);
    let arr: any = [];
    const m = out.match(/\[[\s\S]*\]/); if (m) { try { arr = JSON.parse(m[0]); } catch (e) { /* fall through */ } }
    if (!Array.isArray(arr) || arr.length !== segments.length) return json({ error: 'translation_parse_failed', raw: out.slice(0, 200) }, 502);
    return json({ segments: arr.map((x: any) => String(x || '')) });
  } catch (e) { return json({ error: String(e) }, 500); }
});
