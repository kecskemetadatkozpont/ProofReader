// Publify — Research Agents (multi-agent swarm) Edge Function.
// The Ideas tab's "🤖 Ágensek" mode: instead of one Claude call, a small swarm runs with LIVE per-agent
// feedback streamed to the chat — a Planner splits the task into angles, N Researcher agents investigate
// them IN PARALLEL (web search on when entitled), a Reviewer critiques the findings, and a Synthesizer
// streams the final grounded answer. One turn ≈ 1 (planner) + N (researchers) + 1 (reviewer) + 1 (synth)
// Anthropic calls, so this is COST-HEAVY → gated by assertEntitled('research_agents') + a per-turn toggle.
//
// Output protocol: newline-delimited JSON events (NDJSON), one object per line, so the client can render
// each agent's lane live and stream the synthesizer's answer:
//   {t:'plan',  items:[{id,role,label}]}   the roster (render all lanes at once)
//   {t:'start', a}                          agent a began
//   {t:'status',a, s}                       a live status line for lane a (e.g. a search query)
//   {t:'done',  a, s}                       agent a finished (short summary)
//   {t:'tok',   d}                          a token of the FINAL answer (synthesizer) → append to the bubble
//   {t:'end',   message_id}                 all done; the answer is persisted
//   {t:'err',   a?, m}                      an error
//
// Deploy:  supabase functions deploy research-agents
// Secrets: reuses ANTHROPIC_API_KEY. Optional: RESEARCH_AGENTS_WORKER_MODEL (default claude-sonnet-4-6),
//          RESEARCH_AGENTS_MAX_RESEARCHERS (default 3), RESEARCH_WEBSEARCH_TOOL / _MAX_USES (shared with research-chat).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertEntitled, resolveModel } from '../_shared/entitlement.ts';
import { langDirective, loadProjectLang } from '../_shared/lang.ts';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const WORKER_MODEL = Deno.env.get('RESEARCH_AGENTS_WORKER_MODEL') || 'claude-sonnet-4-6';   // cheaper model for planner/researchers/reviewer (synth uses the caller's model)
const MAX_R = Math.max(1, Math.min(4, parseInt(Deno.env.get('RESEARCH_AGENTS_MAX_RESEARCHERS') || '3', 10)));
const MAX_TOKENS = parseInt(Deno.env.get('RESEARCH_MAX_TOKENS') || '4096', 10);
const HISTORY = parseInt(Deno.env.get('RESEARCH_HISTORY') || '10', 10);
const WS_TOOL = Deno.env.get('RESEARCH_WEBSEARCH_TOOL') || 'web_search_20250305';
const WS_MAX = parseInt(Deno.env.get('RESEARCH_WEBSEARCH_MAX_USES') || '4', 10);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const PLANNER_SYS = `You are the planner of a small research swarm inside a PhD ideation platform. Given the user's request and the project context, break the task into ${MAX_R} DISTINCT, complementary research angles that parallel researcher agents will each investigate. Return ONLY a compact JSON array (no prose, no code fence) of objects, each {"label": "<short 2–5 word title>", "brief": "<one-sentence instruction for that researcher>"}. Angles must not overlap. If the task is narrow, return fewer than ${MAX_R}.`;
const RESEARCHER_SYS = `You are a researcher agent in a swarm. Investigate ONLY your assigned angle for the user's task. Use web search when current facts, recent work, or evidence grounding would help. Return concise, specific findings (key facts, relevant methods/works, numbers) and cite sources where you used them. Do not answer the whole task — just your angle.`;
const REVIEWER_SYS = `You are the critical reviewer of a research swarm. Given the task and the researchers' combined findings, briefly assess: what is well-supported, what is missing or unaddressed, and any contradictions or weak/unsupported claims. Be concise, specific and constructive — this critique guides the final synthesis.`;
const SYNTH_SYS = `You are the synthesizer of a research swarm inside a PhD ideation platform. Merge the researchers' findings and the reviewer's critique into ONE well-structured, evidence-grounded answer for the user. Prefer specific, falsifiable research directions and surface gaps. Cite sources where the researchers used them. Be concise but complete; do not mention the internal agents or this process.`;

// Read one Anthropic SSE stream to completion, firing callbacks as blocks arrive. Reused for every agent.
async function runAgent(headers: Record<string, string>, body: Record<string, unknown>,
  cbs: { onSearch?: (q: string) => void; onToken?: (t: string) => void }): Promise<{ text: string; citations: any[]; stopReason: string }> {
  const sr = await fetch(ANTHROPIC_URL, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }) });
  if (!sr.ok || !sr.body) { const t = await sr.text().catch(() => ''); throw new Error('anthropic ' + sr.status + ' ' + t.slice(0, 200)); }
  const reader = sr.body.getReader(); const dec = new TextDecoder();
  const blocks: any[] = []; let stopReason = ''; let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n\n')) !== -1) {
      const piece = buf.slice(0, nl); buf = buf.slice(nl + 2);
      const dl = piece.split('\n').find((l) => l.startsWith('data:')); if (!dl) continue;
      const raw = dl.slice(5).trim(); if (!raw || raw === '[DONE]') continue;
      let ev: any; try { ev = JSON.parse(raw); } catch { continue; }
      if (ev.type === 'content_block_start') { const b = JSON.parse(JSON.stringify(ev.content_block || {})); if (b.type === 'text' && b.text == null) b.text = ''; blocks[ev.index] = b; }
      else if (ev.type === 'content_block_delta') {
        const d = ev.delta || {};
        if (d.type === 'text_delta' && typeof d.text === 'string') { if (!blocks[ev.index]) blocks[ev.index] = { type: 'text', text: '' }; blocks[ev.index].text = (blocks[ev.index].text || '') + d.text; cbs.onToken && cbs.onToken(d.text); }
        else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') { if (!blocks[ev.index]) blocks[ev.index] = {}; blocks[ev.index]._pj = (blocks[ev.index]._pj || '') + d.partial_json; }
        else if (d.type === 'citations_delta' && d.citation) { if (!blocks[ev.index]) blocks[ev.index] = { type: 'text', text: '' }; (blocks[ev.index].citations = blocks[ev.index].citations || []).push(d.citation); }
      }
      else if (ev.type === 'content_block_stop') { const b = blocks[ev.index]; if (b && b._pj) { try { b.input = JSON.parse(b._pj); } catch { /* keep */ } delete b._pj; if ((b.type === 'server_tool_use' || b.type === 'tool_use') && b.input) { const q = b.input.query || b.input.q; if (q && cbs.onSearch) cbs.onSearch(String(q)); } } }
      else if (ev.type === 'message_delta') { if (ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason; }
    }
  }
  const clean = blocks.filter(Boolean);
  const text = clean.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  const citations = clean.filter((b) => b.type === 'text' && Array.isArray(b.citations)).flatMap((b) => b.citations);
  return { text, citations, stopReason };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503);
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { chat_id, web: reqWeb } = await req.json().catch(() => ({}));
    if (!chat_id) return json({ error: 'chat_id required' }, 400);

    const { data: chat } = await sb.from('research_chats').select('id,project_id').eq('id', chat_id).maybeSingle();
    if (!chat) return json({ error: 'chat not found or no access' }, 404);
    // Multi-agent is its OWN (cost-heavy) entitlement; it does not fall back to research_chat_ideas.
    const gate = await assertEntitled(sb, 'research_agents'); if (gate) return gate;
    const userModel = await resolveModel(sb);
    let webOn = false;
    if (reqWeb) { try { const { data: wsOk } = await sb.rpc('is_feature_enabled', { p_key: 'research_web_search' }); webOn = !!wsOk; } catch { webOn = false; } }

    const { data: proj } = await sb.from('research_projects').select('title,field,goal,keywords').eq('id', chat.project_id).maybeSingle();
    const { data: history } = await sb.from('research_messages').select('role,content').eq('chat_id', chat_id).order('created_at', { ascending: true });
    let rows: any[] = (history || []).filter((m: any) => m.content);
    if (rows.length > HISTORY) rows = rows.slice(-HISTORY);
    if (!rows.length) return json({ error: 'no messages to respond to' }, 400);
    // the task = the latest non-assistant message; a little prior context helps the swarm stay on-thread
    let lastUserIdx = -1; for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].role !== 'assistant') { lastUserIdx = i; break; } }
    const task = String((rows[lastUserIdx] && rows[lastUserIdx].content) || rows[rows.length - 1].content).slice(0, 4000);
    const prior = rows.slice(Math.max(0, lastUserIdx - 4), lastUserIdx).map((m: any) => (m.role === 'assistant' ? 'Publify: ' : 'User: ') + String(m.content).slice(0, 500)).join('\n');

    const ctx = proj ? `\n\nProject — Title: ${proj.title}; Field: ${proj.field ?? '—'}; Goal: ${proj.goal ?? '—'}; Keywords: ${(proj.keywords ?? []).join(', ')}` : '';
    const _lang = await loadProjectLang(sb, chat.project_id);
    const lang = langDirective(_lang);
    const headers: Record<string, string> = { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    const webTool = () => (webOn ? [{ type: WS_TOOL, name: 'web_search', max_uses: WS_MAX }] : undefined);

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (o: unknown) => { try { controller.enqueue(enc.encode(JSON.stringify(o) + '\n')); } catch { /* closed */ } };
        const allCitations: any[] = [];
        try {
          // ---- PLANNER (non-streaming, quick) ----
          send({ t: 'status', a: 'plan', s: '🧭 Terv készítése…' });
          let angles: { label: string; brief: string }[] = [];
          try {
            const pr = await fetch(ANTHROPIC_URL, { method: 'POST', headers, body: JSON.stringify({ model: WORKER_MODEL, max_tokens: 500, system: [{ type: 'text', text: PLANNER_SYS + ctx + lang }], messages: [{ role: 'user', content: task }] }) });
            const pout = await pr.json();
            const ptext = (pout.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
            const mArr = ptext.match(/\[[\s\S]*\]/);
            if (mArr) { const arr = JSON.parse(mArr[0]); if (Array.isArray(arr)) angles = arr.filter((x: any) => x && x.label).map((x: any) => ({ label: String(x.label).slice(0, 60), brief: String(x.brief || x.label).slice(0, 300) })).slice(0, MAX_R); }
          } catch { /* fall through to fallback */ }
          if (!angles.length) angles = [{ label: 'Fő vizsgálat', brief: task }];

          const roster = [
            ...angles.map((a, i) => ({ id: 'r' + i, role: 'researcher', label: a.label })),
            { id: 'rev', role: 'reviewer', label: 'Kritikus értékelés' },
            { id: 'syn', role: 'synth', label: 'Szintézis' },
          ];
          send({ t: 'plan', items: roster });

          // ---- RESEARCHERS (parallel) ----
          const findings = await Promise.all(angles.map(async (a, i) => {
            const id = 'r' + i;
            send({ t: 'start', a: id });
            const body: Record<string, unknown> = { model: WORKER_MODEL, max_tokens: 1600, system: [{ type: 'text', text: RESEARCHER_SYS + ctx + lang }], messages: [{ role: 'user', content: `Assigned angle: ${a.label}\n${a.brief}\n\nUser's task: ${task}` }] };
            const wt = webTool(); if (wt) body.tools = wt;
            try {
              const res = await runAgent(headers, body, { onSearch: (q) => send({ t: 'status', a: id, s: '🌐 ' + q.slice(0, 60) }) });
              for (const c of res.citations) allCitations.push(c);
              send({ t: 'done', a: id, s: '✅ kész' + (res.citations.length ? ' · ' + res.citations.length + ' forrás' : '') });
              return { label: a.label, text: res.text };
            } catch (e) { send({ t: 'done', a: id, s: '⚠️ hiba' }); return { label: a.label, text: '' }; }
          }));
          const findingsText = findings.filter((f) => f.text).map((f) => `### ${f.label}\n${f.text}`).join('\n\n') || '(a kutatók nem adtak vissza eredményt)';

          // ---- REVIEWER ----
          send({ t: 'start', a: 'rev' });
          let critique = '';
          try {
            const rev = await runAgent(headers, { model: WORKER_MODEL, max_tokens: 1200, system: [{ type: 'text', text: REVIEWER_SYS + lang }], messages: [{ role: 'user', content: `Task: ${task}\n\nResearchers' findings:\n${findingsText}` }] }, {});
            critique = rev.text; send({ t: 'done', a: 'rev', s: '✅ kész' });
          } catch { send({ t: 'done', a: 'rev', s: '⚠️ hiba' }); }

          // ---- SYNTHESIZER (streams the answer) — retry ONCE (2nd try falls back to the worker model in case the caller's
          //      model is the problem), and surface the real error instead of swallowing it. ----
          send({ t: 'start', a: 'syn' });
          const priorNote = prior ? `\n\nEarlier in the conversation:\n${prior}` : '';
          const synMsg = `Task: ${task}${priorNote}\n\nResearchers' findings:\n${findingsText}\n\nReviewer's critique:\n${critique || '(none)'}\n\nWrite the final grounded answer for the user.`;
          let answer = '';
          let synErr = '';
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const syn = await runAgent(headers, { model: attempt === 0 ? userModel : WORKER_MODEL, max_tokens: MAX_TOKENS, system: [{ type: 'text', text: SYNTH_SYS + ctx + lang, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: synMsg }] },
                { onToken: (t) => { answer += t; send({ t: 'tok', d: t }); } });
              for (const c of syn.citations) allCitations.push(c);
              if (!answer) { answer = syn.text; if (answer) send({ t: 'tok', d: answer }); }
              break;
            } catch (e) { synErr = String(e); if (attempt === 0 && !answer) { send({ t: 'status', a: 'syn', s: '⚠️ újrapróbálás…' }); await new Promise((r) => setTimeout(r, 1500)); continue; } break; }
          }
          send({ t: 'done', a: 'syn', s: answer.trim() ? '✅ kész' : '⚠️ hiba' });

          // ---- persist. If the synthesizer produced NOTHING, do NOT discard the swarm's work — surface the reason and fall
          //      back to the researchers' findings (+ the reviewer's critique) so the user still gets a useful, grounded message.
          let finalText = answer.trim();
          if (!finalText) {
            if (findings.some((f) => f.text)) {
              finalText = 'ℹ️ A végső összegzés most nem készült el' + (synErr ? ' (' + synErr.slice(0, 140) + ')' : '') + ' — a kutató-ágensek eredményei:\n\n' + findingsText + (critique ? '\n\n---\n\n**Kritikus értékelés**\n\n' + critique : '');
            } else {
              finalText = '⚠️ Az ágensek most nem adtak vissza eredményt' + (synErr ? ' — ' + synErr.slice(0, 140) : '') + '. Próbáld újra, vagy küldd el Ágens-mód nélkül (a 🤖 gombbal kikapcsolva).';
            }
            send({ t: 'tok', d: finalText });   // stream the fallback so the live bubble isn't left empty
          }
          let messageId: string | null = null;
          try {
            const { data: saved } = await sb.from('research_messages').insert({ chat_id, role: 'assistant', content: finalText, blocks: [{ type: 'agent_trace', roster }] }).select('id').maybeSingle();
            messageId = saved?.id ?? null;
            const seen = new Set<string>();
            const ev = allCitations.filter((c) => c && c.cited_text).map((c) => {
              const src = c.document_title || c.title || c.url || null;
              const snippet = c.url ? String(c.cited_text).slice(0, 3900) + '\n[' + c.url + ']' : String(c.cited_text).slice(0, 4000);
              return { chat_id, message_id: messageId, query: src, snippet };
            }).filter((e) => { const k = (e.query || '') + '|' + e.snippet.slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; });
            if (ev.length) await sb.from('research_evidence').insert(ev);
          } catch { /* persistence best-effort */ }

          send({ t: 'end', message_id: messageId });
          controller.close();
        } catch (e) { send({ t: 'err', m: String(e) }); try { controller.close(); } catch { /* */ } }
      },
    });
    return new Response(stream, { headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
