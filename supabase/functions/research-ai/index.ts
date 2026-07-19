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
import { assertEntitled, resolveModel } from '../_shared/entitlement.ts';
import { langDirective, loadProjectLang } from '../_shared/lang.ts';

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
    const { action = 'gap', project_id, canvas, text } = await req.json().catch(() => ({}));
    if (!project_id) return json({ error: 'project_id required' }, 400);
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set on the function' }, 503);

    // RLS-scoped reads: only succeeds if the caller can read this project
    const { data: proj } = await sb.from('research_projects')
      .select('title,field,keywords,goal').eq('id', project_id).maybeSingle();
    if (!proj) return json({ error: 'project not found or no access' }, 404);

    // per-user model assigned by an admin (profiles.ai_model); fall back to the env default if unset/invalid
    const { data: ures } = await sb.auth.getUser();
    const gate = await assertEntitled(sb, 'research_chat_ideas'); if (gate) return gate;
    const { data: profRow } = await sb.from('profiles').select('ai_model').eq('id', ures?.user?.id ?? '').maybeSingle();
    const userModel = await resolveModel(sb);
    // per-project output language for USER-FACING generation (search keywords stay English elsewhere)
    const _lang = await loadProjectLang(sb, project_id);

    // Research Canvas: free-text summary of the edgeless whiteboard (no DB writes).
    if (action === 'canvas-summary') {
      const summary = await summarizeCanvas(proj, String(canvas || '').slice(0, 12000), userModel, _lang);
      return json({ ok: true, summary });
    }
    // #6 — automatic prompt enhancement: rewrite the user's chat prompt to be clearer/more specific (no DB writes)
    if (action === 'enhance') {
      const improved = await enhancePrompt(proj, String(text || '').slice(0, 4000), userModel);
      return json({ ok: true, text: improved });
    }
    // #2 — continuously suggest research ideas grounded in the chat conversation; inserted as candidates the
    // user accepts/rejects in the Ideas list. Deduped against existing ideas; returns at most 3 per call.
    if (action === 'suggest') {
      const { data: existing } = await sb.from('research_ideas').select('question').eq('project_id', project_id).limit(60);
      const existingQs = (existing || []).map((e: any) => String(e.question || ''));
      const ideas = await suggestFromChat(proj, String(text || '').slice(0, 9000), existingQs, userModel, _lang);
      const rows = ideas.slice(0, 3).map((i: any) => ({
        project_id, source: 'chat', question: String(i.question || '').slice(0, 600),
        hypothesis: i.hypothesis ? String(i.hypothesis).slice(0, 800) : null,
        rationale: i.rationale ? String(i.rationale).slice(0, 1000) : null,
        status: 'candidate',
      })).filter((r: any) => r.question);
      if (rows.length) {
        // return the inserted rows (id + fields) so the client can place EXACTLY these (race-free) instead of
        // guessing "newest N in the project" by created_at — which can grab a concurrent writer's ideas.
        const { data: ins, error } = await sb.from('research_ideas').insert(rows).select('id,question,source,novelty,status,created_at');
        if (error) return json({ error: 'insert failed: ' + error.message }, 403);
        return json({ ok: true, count: (ins || rows).length, ideas: ins || [] });
      }
      return json({ ok: true, count: 0, ideas: [] });
    }
    // #3 — first-class RESEARCH-GAP ANALYSIS: typed, evidence-grounded gaps (migration-83). Distinct from the legacy
    // action='gap' (untyped questions) which stays byte-identical. Returns the SAME {ok,count,ideas} shape.
    if (action === 'gap_analyze') {
      const { data: gsrc } = await sb.from('research_sources')
        .select('id,title,year,venue,abstract,screening').eq('project_id', project_id).order('cited_by', { ascending: false, nullsFirst: false }).limit(60);
      const all = gsrc || [];
      const inc = all.filter((s: any) => s.screening === 'include' || s.screening === 'included');
      const lib = (inc.length >= 4 ? inc : all);   // prefer the screened-in library; fall back to everything
      const N = lib.length;
      const TYPES = ['evidence', 'knowledge', 'methodological', 'population', 'theoretical', 'practical', 'contradictory'];
      const gaps = await askClaudeGaps(proj, lib, userModel, _lang);
      const rows = (gaps || []).slice(0, 8).map((g: any) => {
        // validate evidence source_ref indices against the ACTUAL library length — drop hallucinated citations
        const ev = Array.isArray(g.evidence) ? g.evidence.map((e: any) => {
          const ref = Number(e && e.source_ref);
          const src = (Number.isFinite(ref) && ref >= 1 && ref <= N) ? lib[ref - 1] : null;
          return src ? { source_id: src.id, title: String(src.title || '').slice(0, 200), coverage: String((e && e.coverage) || '').slice(0, 200) } : null;
        }).filter(Boolean).slice(0, 6) : [];
        const gt = TYPES.indexOf(String(g.gap_type || '').toLowerCase().trim()) >= 0 ? String(g.gap_type).toLowerCase().trim() : 'knowledge';
        return {
          project_id, source: 'gap', status: 'candidate', gap_type: gt, evidence: ev,
          question: String(g.statement || g.question || '').slice(0, 600),
          rationale: g.rationale ? String(g.rationale).slice(0, 1000) : null,
          hypothesis: g.suggested_question ? String(g.suggested_question).slice(0, 800) : null,
          novelty: Number.isFinite(g.novelty) ? Math.max(0, Math.min(100, Math.round(g.novelty))) : null,
        };
      }).filter((r: any) => r.question);
      if (!rows.length) return json({ ok: true, count: 0, ideas: [] });
      let res = await sb.from('research_ideas').insert(rows).select('id,question,source,novelty,status,gap_type,evidence,created_at');
      if (res.error && /gap_type|evidence|addressed_by|column/i.test(res.error.message)) {
        // migration-83 not applied yet → insert untyped gaps so the feature still works (client shows a degrade banner)
        const bare = rows.map((r: any) => { const { gap_type, evidence, ...rest } = r; return rest; });
        res = await sb.from('research_ideas').insert(bare).select('id,question,source,novelty,status,created_at');
      }
      if (res.error) return json({ error: 'insert failed: ' + res.error.message }, 403);
      return json({ ok: true, count: (res.data || rows).length, ideas: res.data || [] });
    }
    // evidence-gap MATRIX (EGM): derive method×domain axes from the library and count coverage per cell (empty cells = gaps).
    if (action === 'gap_matrix') {
      const { data: msrc } = await sb.from('research_sources')
        .select('title,year,venue,abstract,screening').eq('project_id', project_id).order('cited_by', { ascending: false, nullsFirst: false }).limit(60);
      const all = msrc || [];
      const inc = all.filter((s: any) => s.screening === 'include' || s.screening === 'included');
      const lib = (inc.length >= 4 ? inc : all);
      if (lib.length < 3) return json({ ok: true, matrix: null, reason: 'too_few' });
      const matrix = await askClaudeMatrix(proj, lib, userModel, _lang);
      return json({ ok: true, matrix: matrix, count: lib.length });
    }

    // allow-list the generic (writing) gap path — only 'gap' (default) and 'ideas' reach it. Any unrecognized action
    // (e.g. a client calling a NEW read-only action against an OLD build) must NOT silently insert gap ideas.
    if (action !== 'gap' && action !== 'ideas') return json({ error: 'unknown action: ' + action }, 400);
    const { data: sources } = await sb.from('research_sources')
      .select('title,year,venue,abstract').eq('project_id', project_id).limit(40);

    const ideas = await askClaude(action, proj, sources || [], userModel, _lang);
    if (ideas.length) {
      const rows = ideas.slice(0, 8).map((i: any) => ({
        project_id, source: 'gap', question: String(i.question || '').slice(0, 600),
        hypothesis: i.hypothesis ? String(i.hypothesis).slice(0, 800) : null,
        rationale: i.rationale ? String(i.rationale).slice(0, 1000) : null,
        novelty: Number.isFinite(i.novelty) ? Math.max(0, Math.min(100, Math.round(i.novelty))) : null,
        status: 'candidate',
      }));
      // return the inserted rows so a frame-scoped caller can place EXACTLY these ideas (race-free), not "newest N".
      const { data: ins, error } = await sb.from('research_ideas').insert(rows).select('id,question,source,novelty,status,created_at');   // caller's RLS — needs write access
      if (error) return json({ error: 'insert failed: ' + error.message }, 403);
      return json({ ok: true, count: (ins || rows).length, ideas: ins || [] });
    }
    return json({ ok: true, count: 0, ideas: [] });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

async function summarizeCanvas(proj: any, canvas: string, model: string, lang: 'en' | 'hu'): Promise<string> {
  const prompt = `Egy kutató edgeless vásznát (Research Canvas) kapod: tipizált csomópontok (jegyzet/ötlet/publikáció/forrás/adat) és tipizált kapcsolatok (kapcsolódik/alátámaszt/cáfol/vezet-hozzá). Projekt: "${proj.title}"${proj.field ? ' (' + proj.field + ')' : ''}.

VÁSZON TARTALMA:
${canvas || '(üres)'}

Készíts TÖMÖR összefoglalót a témavezető/kutató számára: (1) mi a vászon fő gondolatmenete, (2) az érvstruktúra (mi mit támaszt alá vagy cáfol), (3) 2-3 konkrét következő lépés vagy nyitott kérdés. Csak a megadott tartalomra támaszkodj. Markdown, max ~180 szó.` + langDirective(lang);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
  });
  const out = await r.json();
  if (out.error) throw new Error(out.error.message || 'anthropic error');
  return (out.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
}

async function enhancePrompt(proj: any, text: string, model: string): Promise<string> {
  if (!text.trim()) return text;
  const ctx = `Project: "${proj.title || ''}"${proj.field ? ' (' + proj.field + ')' : ''}.${proj.goal ? ' Goal: ' + proj.goal + '.' : ''}${(proj.keywords && proj.keywords.length) ? ' Keywords: ' + proj.keywords.join(', ') + '.' : ''}`;
  const prompt = `You improve prompts for an AI research assistant. Rewrite the user's message below to be clearer, more specific and well-structured: keep the SAME language and intent, expand vague terms, and add helpful framing where obvious — but do not invent facts or answer it. Return ONLY the improved prompt text — no preamble, no quotes, no explanation.

Context: ${ctx}

User's message:
${text}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
  });
  const out = await r.json();
  if (out.error) throw new Error(out.error.message || 'anthropic error');
  const t = (out.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  return t || text;
}

async function suggestFromChat(proj: any, transcript: string, existingQs: string[], model: string, lang: 'en' | 'hu'): Promise<any[]> {
  if (!transcript.trim()) return [];
  const avoid = existingQs.slice(0, 40).map((q) => '- ' + q).join('\n');
  const prompt = `You watch a researcher's chat and surface NEW research ideas as they emerge. Project: "${proj.title || ''}"${proj.field ? ' (' + proj.field + ')' : ''}.${proj.goal ? ' Goal: ' + proj.goal + '.' : ''}

From the conversation below, propose 1-3 concrete, specific research ideas/questions that genuinely emerged from it. Each must be well-grounded in what was discussed — do NOT invent generic ideas, and do NOT repeat anything already in this list:
${avoid || '(none yet)'}

Conversation (most recent last):
${transcript}

Return ONLY a JSON array, no prose. Each item: {"question": "...", "hypothesis": "... or null", "rationale": "one sentence on why this follows from the conversation"}. If nothing genuinely new is worth proposing, return [].` + langDirective(lang);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
  });
  const out = await r.json();
  if (out.error) throw new Error(out.error.message || 'anthropic error');
  const txt = (out.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
  const m = txt.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try { const arr = JSON.parse(m[0]); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

async function askClaude(action: string, proj: any, sources: any[], model: string, lang: 'en' | 'hu'): Promise<any[]> {
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
{"question": "...", "hypothesis": "...", "rationale": "why this is a gap / novel", "novelty": 0-100}` + langDirective(lang);

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

// Typed, evidence-grounded gap analysis (action='gap_analyze'). Returns [{gap_type,statement,evidence:[{source_ref,coverage}],rationale,novelty,suggested_question}].
async function askClaudeGaps(proj: any, sources: any[], model: string, lang: 'en' | 'hu'): Promise<any[]> {
  const lib = sources.map((s, i) =>
    `[${i + 1}] ${s.title} (${s.year ?? 'n.d.'}, ${s.venue ?? ''})\n${(s.abstract ?? '').slice(0, 500)}`).join('\n\n');
  const prompt =
`You are a research methodology assistant performing a rigorous RESEARCH-GAP ANALYSIS.

PROJECT
Title: ${proj.title}
Field: ${proj.field ?? '—'}
Keywords: ${(proj.keywords ?? []).join(', ') || '—'}
Goal: ${proj.goal ?? '—'}

LITERATURE LIBRARY (${sources.length} items, numbered)
${lib || '(none yet)'}

Identify 4-6 concrete research GAPS: what the literature above does NOT resolve or cover, given the goal.
Classify EACH gap by exactly ONE type slug from this taxonomy:
- evidence: little or no empirical evidence for a claim
- knowledge: the knowledge does not exist, or not where one would expect it
- methodological: the topic was studied only with the same limited method/measurement
- population: not tested on a given population / domain / operational context
- theoretical: a missing or competing theoretical framework
- practical: a gap between the recommendation and actual practice
- contradictory: multiple credible sources conflict and it is unresolved

Ground every gap in the library: cite supporting papers by their [number] and state what is ABSENT.

Return ONLY a JSON array, no prose. Each item:
{"gap_type":"<one slug from the list>","statement":"the gap in one clear sentence","evidence":[{"source_ref":<library item number>,"coverage":"what this paper covers regarding the gap"}],"rationale":"why this is a gap — what the library does or does not cover","novelty":0-100,"suggested_question":"a concrete, testable research question that would close the gap"}` + langDirective(lang);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: Math.max(MAX_TOKENS, 2200), messages: [{ role: 'user', content: prompt }] }),
  });
  const j = await r.json();
  const text = (j?.content?.[0]?.text) || '';
  const mm = text.match(/\[[\s\S]*\]/);
  try { return mm ? JSON.parse(mm[0]) : []; } catch { return []; }
}

// Evidence-gap MATRIX (action='gap_matrix') → {rows:[...], cols:[...], cells:[[int,...],...]} where cells[r][c] = #library items covering rows[r]×cols[c]. Empty cells are the gaps.
async function askClaudeMatrix(proj: any, sources: any[], model: string, lang: 'en' | 'hu'): Promise<any> {
  const lib = sources.map((s, i) => `[${i + 1}] ${s.title} (${s.year ?? 'n.d.'})\n${(s.abstract ?? '').slice(0, 300)}`).join('\n\n');
  const prompt =
`You build an EVIDENCE-GAP MAP (EGM) for a research project — a matrix whose EMPTY cells reveal research gaps.

PROJECT: ${proj.title}${proj.goal ? ' — ' + proj.goal : ''}
Field: ${proj.field ?? '—'}; Keywords: ${(proj.keywords ?? []).join(', ') || '—'}

LITERATURE (${sources.length} items, numbered):
${lib || '(none)'}

Derive TWO axes that best organise THIS literature into a gap map:
- rows = the main METHODS / interventions / approaches (3 to 5)
- cols = the main DOMAINS / datasets / outcomes / contexts (3 to 5)
Then for every (row,col) cell count how many of the numbered library items above genuinely cover that combination. Cells with 0 are the research gaps. Keep every label short (<= 22 chars) and in the project language.

Return ONLY JSON, no prose: {"rows":["..."],"cols":["..."],"cells":[[<int>, ...], ...]} where cells has one array per row (same order as rows) and one int per col (same order as cols).` + langDirective(lang);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1400, messages: [{ role: 'user', content: prompt }] }),
  });
  const j = await r.json();
  const text = (j?.content?.[0]?.text) || '';
  const m = text.match(/\{[\s\S]*\}/);
  try {
    const o = m ? JSON.parse(m[0]) : null;
    if (o && Array.isArray(o.rows) && Array.isArray(o.cols) && Array.isArray(o.cells)) return o;
  } catch { /* fall through */ }
  return null;
}
