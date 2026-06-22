// Publify — Research AI Edge Function (R1).
// Secure server-side proxy to Claude for research idea / gap analysis. The Anthropic key lives only
// here (Edge secret), never in the browser. Reads the project + its literature under the CALLER's
// JWT (RLS applies), asks Claude for candidate research questions, inserts them as research_ideas
// (source='gap'). Called from the app via supabase.functions.invoke('research-ai', { body }).
//
// Deploy:  supabase functions deploy research-ai
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// (Model override optional:  supabase secrets set RESEARCH_AI_MODEL=claude-sonnet-4-6)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('RESEARCH_AI_MODEL') || 'claude-sonnet-4-6';
// admins assign a per-user model (profiles.ai_model); validate before trusting it
const ALLOWED_MODELS = new Set(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
const MAX_TOKENS = parseInt(Deno.env.get('RESEARCH_MAX_TOKENS') || '1500', 10);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    );
    const { action = 'gap', project_id, canvas } = await req.json().catch(() => ({}));
    if (!project_id) return json({ error: 'project_id required' }, 400);
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set on the function' }, 503);

    // RLS-scoped reads: only succeeds if the caller can read this project
    const { data: proj } = await sb.from('research_projects')
      .select('title,field,keywords,goal').eq('id', project_id).maybeSingle();
    if (!proj) return json({ error: 'project not found or no access' }, 404);

    // per-user model assigned by an admin (profiles.ai_model); fall back to the env default if unset/invalid
    const { data: ures } = await sb.auth.getUser();
    const { data: profRow } = await sb.from('profiles').select('ai_model').eq('id', ures?.user?.id ?? '').maybeSingle();
    const userModel = (profRow && profRow.ai_model && ALLOWED_MODELS.has(profRow.ai_model)) ? profRow.ai_model : MODEL;

    // Research Canvas: free-text summary of the edgeless whiteboard (no DB writes).
    if (action === 'canvas-summary') {
      const summary = await summarizeCanvas(proj, String(canvas || '').slice(0, 12000), userModel);
      return json({ ok: true, summary });
    }
    const { data: sources } = await sb.from('research_sources')
      .select('title,year,venue,abstract').eq('project_id', project_id).limit(40);

    const ideas = await askClaude(action, proj, sources || [], userModel);
    if (ideas.length) {
      const rows = ideas.slice(0, 8).map((i: any) => ({
        project_id, source: 'gap', question: String(i.question || '').slice(0, 600),
        hypothesis: i.hypothesis ? String(i.hypothesis).slice(0, 800) : null,
        rationale: i.rationale ? String(i.rationale).slice(0, 1000) : null,
        novelty: Number.isFinite(i.novelty) ? Math.max(0, Math.min(100, Math.round(i.novelty))) : null,
        status: 'candidate',
      }));
      const { error } = await sb.from('research_ideas').insert(rows);   // caller's RLS — needs write access
      if (error) return json({ error: 'insert failed: ' + error.message }, 403);
    }
    return json({ ok: true, count: ideas.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

async function summarizeCanvas(proj: any, canvas: string, model: string): Promise<string> {
  const prompt = `Egy kutató edgeless vásznát (Research Canvas) kapod: tipizált csomópontok (jegyzet/ötlet/publikáció/forrás/adat) és tipizált kapcsolatok (kapcsolódik/alátámaszt/cáfol/vezet-hozzá). Projekt: "${proj.title}"${proj.field ? ' (' + proj.field + ')' : ''}.

VÁSZON TARTALMA:
${canvas || '(üres)'}

Készíts TÖMÖR, magyar nyelvű összefoglalót a témavezető/kutató számára: (1) mi a vászon fő gondolatmenete, (2) az érvstruktúra (mi mit támaszt alá vagy cáfol), (3) 2-3 konkrét következő lépés vagy nyitott kérdés. Csak a megadott tartalomra támaszkodj. Markdown, max ~180 szó.`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
  });
  const out = await r.json();
  if (out.error) throw new Error(out.error.message || 'anthropic error');
  return (out.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
}

async function askClaude(action: string, proj: any, sources: any[], model: string): Promise<any[]> {
  const lib = sources.map((s, i) =>
    `[${i + 1}] ${s.title} (${s.year ?? 'n.d.'}, ${s.venue ?? ''})\n${(s.abstract ?? '').slice(0, 600)}`).join('\n\n');
  const verb = action === 'ideas' ? 'Propose novel research directions' : 'Perform a research-gap analysis';
  const prompt =
`You are a research methodology assistant. ${verb} for this project.

PROJECT
Title: ${proj.title}
Field: ${proj.field ?? '—'}
Keywords: ${(proj.keywords ?? []).join(', ') || '—'}
Goal: ${proj.goal ?? '—'}

LITERATURE IN THE PROJECT LIBRARY (${sources.length} items)
${lib || '(none yet)'}

Identify what is under-explored or unresolved and propose 4-6 concrete, testable research questions that
would advance the field given the goal and the literature above. Ground each in what the library does or
does not cover.

Return ONLY a JSON array, no prose, each item:
{"question": "...", "hypothesis": "...", "rationale": "why this is a gap / novel", "novelty": 0-100}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] }),
  });
  const j = await r.json();
  const text = (j?.content?.[0]?.text) || '';
  const m = text.match(/\[[\s\S]*\]/);
  try { return m ? JSON.parse(m[0]) : []; } catch { return []; }
}
