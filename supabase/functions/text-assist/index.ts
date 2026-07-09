import { createClient } from 'jsr:@supabase/supabase-js@2';
import { assertEntitled, clampModel } from '../_shared/entitlement.ts';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = 'claude-sonnet-4-6';   // writing quality matters here
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

const RULES = 'STRICT: preserve the original meaning, all factual claims, numbers, units, and citations. Keep ALL LaTeX intact and valid — commands (\\cite, \\ref, \\eqref, \\label, \\textbf, …), math ($…$, \\(…\\), equation environments), and special characters. Do not add or remove citations or claims. Return ONLY the rewritten text — no preamble, no surrounding quotes, no Markdown code fences, no explanation.';
const ACTIONS: Record<string, string> = {
  improve: 'Improve the clarity, flow, and academic quality of the following manuscript text.',
  condense: 'Make the following manuscript text more concise — remove redundancy and tighten the prose — without losing substantive content.',
  expand: 'Expand the following manuscript text with appropriate academic detail and connective prose, staying strictly faithful to its meaning (invent no new claims, citations, or numbers).',
  academic: 'Rewrite the following text in a precise, formal academic register suitable for a peer-reviewed journal manuscript.',
  grammar: 'Correct only the grammar, spelling, and punctuation of the following text. Make no stylistic or content changes beyond correctness.',
  simplify: 'Rewrite the following text to be clearer and easier to read (plainer, shorter sentences) without dumbing it down.',
};

async function callClaude(system: string, text: string, model: string): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 2000, system, messages: [{ role: 'user', content: text }] }),
  });
  const o = await r.json(); if (o.error) throw new Error(o.error.message || 'anthropic');
  return (o.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: ures } = await sb.auth.getUser();
    if (!ures || !ures.user) return json({ error: 'unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const text = String(body.text || '').slice(0, 12000);
    const action = String(body.action || 'improve');
    if (!text.trim()) return json({ error: 'no text' }, 400);
    const gate = await assertEntitled(sb, 'ai_writing_assist'); if (gate) return gate;
    const model = await clampModel(sb, MODEL);
    const instr = ACTIONS[action] || ACTIONS.improve;
    const system = `You are an expert academic copy-editor helping a researcher revise a manuscript. ${instr}\n\n${RULES}`;
    const result = await callClaude(system, text, model);
    return json({ result });
  } catch (e) { return json({ error: String(e) }, 500); }
});
