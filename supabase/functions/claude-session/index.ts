// Publify — Claude Session Edge Function. A plain, full Claude chat (Zola-style), independent of research
// projects. Loads a user_chats conversation under the CALLER's JWT (RLS = owner-only), streams one reply,
// persists it. Uses the caller's per-user model (profiles.ai_model). No MCP, no project context.
//
// Deploy:  supabase functions deploy claude-session --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertEntitled, resolveModel } from '../_shared/entitlement.ts';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('RESEARCH_AI_MODEL') || 'claude-sonnet-4-6';
const ALLOWED_MODELS = new Set(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
const MAX_TOKENS = parseInt(Deno.env.get('SESSION_MAX_TOKENS') || '4096', 10);
const HISTORY = parseInt(Deno.env.get('SESSION_HISTORY') || '20', 10);
const WS_TOOL = Deno.env.get('RESEARCH_WEBSEARCH_TOOL') || 'web_search_20250305';   // Anthropic server-side web search (shared config with research-chat)
const WS_MAX = parseInt(Deno.env.get('RESEARCH_WEBSEARCH_MAX_USES') || '4', 10);
// ---- Multi-agent swarm (mode:'agents') — the Research Idea Chat's 🤖 agents, brought into the plain session chat.
const WORKER_MODEL = Deno.env.get('RESEARCH_AGENTS_WORKER_MODEL') || 'claude-sonnet-4-6';   // cheaper model for planner/workers/reviewer; synth uses the caller's model
const MAX_R = Math.max(1, Math.min(4, parseInt(Deno.env.get('RESEARCH_AGENTS_MAX_RESEARCHERS') || '3', 10)));
const AG_PLANNER_SYS = `You are the planner of a small assistant swarm inside Publify, a research platform. Given the user's request (and any attached materials), break the task into ${MAX_R} DISTINCT, complementary angles that parallel worker agents will each handle. Return ONLY a compact JSON array (no prose, no code fence) of objects, each {"label":"<short 2–5 word title>","brief":"<one-sentence instruction for that worker>"}. Angles must not overlap. If the task is narrow, return fewer than ${MAX_R}.`;
const AG_WORKER_SYS = `You are a worker agent in a swarm. Handle ONLY your assigned angle for the user's task. Use web search when current facts, recent work, or grounding would help. Return concise, specific findings (key facts, methods, numbers, sources) and cite where you used them. Do not answer the whole task — just your angle. Answer in the user's language.`;
const AG_REVIEWER_SYS = `You are the critical reviewer of the swarm. Given the task and the workers' combined findings, briefly assess: what is well-supported, what is missing, and any contradictions or weak claims. Be concise, specific and constructive. Answer in the user's language.`;
const AG_SYNTH_SYS = `You are the synthesizer of the swarm inside Publify. Merge the workers' findings and the reviewer's critique into ONE well-structured, grounded answer for the user. Be concise but complete; cite sources where used; ground in any attached materials. Do not mention the internal agents or this process. Answer in the user's language. Use Markdown.`;
const SYSTEM = `You are Publify, a helpful, knowledgeable research assistant inside the Publify platform. You help researchers with their writing, publications, and projects. Answer clearly and concisely in the user's language. Use Markdown; put code in fenced code blocks. When the user has attached documents, LaTeX/research projects, or publications, ground your answers in them and cite which attachment you used.`;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Org-level Elicit MCP token (migration-53) — read + refresh if near expiry. Service-role only.
async function getOrgElicitToken(svc: any): Promise<string | null> {
  const { data: org } = await svc.from('elicit_mcp_org').select('access_token,refresh_token,expires_at,client_id').eq('id', 1).maybeSingle();
  if (!org || !org.access_token) return null;
  if (org.expires_at && new Date(org.expires_at).getTime() > Date.now() + 60000) return org.access_token;
  if (!org.refresh_token || !org.client_id) return org.access_token;
  try {
    const r = await fetch('https://elicit.com/api/auth/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: org.refresh_token, client_id: org.client_id }) });
    const o = await r.json().catch(() => ({}));
    if (r.ok && o.access_token) {
      await svc.from('elicit_mcp_org').update({ access_token: o.access_token, refresh_token: o.refresh_token || org.refresh_token, expires_at: new Date(Date.now() + (o.expires_in || 3600) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('id', 1);
      return o.access_token;
    }
  } catch (_e) { /* fall through to the stale token — Anthropic will just skip the tools */ }
  return org.access_token;
}

// Read one Anthropic SSE stream to completion, firing callbacks as blocks arrive. Used by the agent swarm (mode:'agents').
async function runSwarmAgent(headers: Record<string, string>, body: Record<string, unknown>,
  cbs: { onSearch?: (q: string) => void; onToken?: (t: string) => void }): Promise<{ text: string; citations: any[]; stopReason: string }> {
  const sr = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }) });
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
    const { chat_id, stream: wantStream, mode, web: reqWeb } = await req.json().catch(() => ({}));
    if (!chat_id) return json({ error: 'chat_id required' }, 400);

    const { data: chat } = await sb.from('user_chats').select('id').eq('id', chat_id).maybeSingle();
    if (!chat) return json({ error: 'chat not found or no access' }, 404);
    const { data: ures } = await sb.auth.getUser();
    const uid = (ures && ures.user && ures.user.id) || '';
    const gate = await assertEntitled(sb, 'page_session'); if (gate) return gate;
    const { data: profRow } = await sb.from('profiles').select('ai_model,can_workflows').eq('id', uid).maybeSingle();
    const model = await resolveModel(sb);
    // Optional web search (Anthropic server-side tool) — gated by the same entitlement as the research chat; if the user
    // isn't entitled, webOn stays false and the toggle is silently ignored (graceful).
    let webOn = false;
    if (reqWeb) { try { const { data: wsOk } = await sb.rpc('is_feature_enabled', { p_key: 'research_web_search' }); webOn = !!wsOk; } catch { webOn = false; } }

    const { data: history } = await sb.from('user_chat_messages').select('role,content').eq('chat_id', chat_id).order('created_at', { ascending: true });
    let rows = (history || []).filter((m: any) => m.content);
    if (rows.length > HISTORY) rows = rows.slice(-HISTORY);
    if (!rows.length) return json({ error: 'no messages to respond to' }, 400);
    let messages: any[] = rows.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    // Attached materials (uploads / PDFs / LaTeX & research projects / publications) → text injected as context
    // so Publify "sees" them in normal chat too. Images go through the vision API (below); agent-written
    // workspace files are excluded (workflow tools read those).
    const { data: filesData } = await sb.from('user_chat_files').select('path,content,source').eq('chat_id', chat_id).order('path');
    let attachCtx = '';
    if (filesData && filesData.length) {
      let budget = 60000; const parts: string[] = [];
      for (const f of (filesData as any[])) {
        if (f.source === 'agent' || f.source === 'image') continue;
        const c = String(f.content || ''); if (!c) continue;
        const chunk = `### ${f.path}\n${c.slice(0, 24000)}`;
        if (budget - chunk.length < 0) { parts.push(`### ${f.path}\n_(túl nagy — kihagyva a kontextusból)_`); continue; }
        budget -= chunk.length; parts.push(chunk);
      }
      const imgNames = (filesData as any[]).filter((f) => f.source === 'image').map((f) => f.path);
      if (imgNames.length) parts.push('_Csatolt képek (a vízió-API kapja meg): ' + imgNames.join(', ') + '_');
      if (parts.length) attachCtx = '\n\n# Csatolt anyagok\nA felhasználó az alábbi dokumentumokat / projekteket / publikációkat / képeket csatolta. Használd őket, ha relevánsak, és jelezd, melyikre támaszkodtál.\n\n' + parts.join('\n\n---\n\n');
    }
    const systemFull = SYSTEM + attachCtx;

    // Attached images → append as vision blocks to the most recent user message.
    const imgFiles = (filesData || []).filter((f: any) => f.source === 'image' && /^data:image\//.test(String(f.content || '')));
    if (imgFiles.length) {
      const blocks: any[] = [];
      for (const f of imgFiles.slice(0, 6)) {
        const mm = /^data:(image\/[a-z.+-]+);base64,(.+)$/i.exec(String(f.content));
        if (mm) blocks.push({ type: 'image', source: { type: 'base64', media_type: mm[1], data: mm[2] } });
      }
      if (blocks.length) {
        let li = -1; for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'user') { li = i; break; } }
        if (li >= 0) messages[li] = { role: 'user', content: [{ type: 'text', text: String(messages[li].content) }, ...blocks] };
      }
    }

    const headers: Record<string, string> = { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    // Nudge the model to ACTUALLY search when web is on — otherwise it often replies "I have no real-time data" even with the tool available.
    const WEB_NOTE = ' Web search is ENABLED. When the user asks about anything current, recent, real-time or time-sensitive — news, currently OPEN calls/grants/tenders/opportunities, recent research or publications, prices, dates, or anything phrased as "latest"/"2025"/"jelenleg"/"most nyitott" — you MUST use the web_search tool to look it up and cite live sources, instead of replying that your knowledge is not up to date. Prefer authoritative/official sources (e.g. the relevant agency or ministry site) and cite them.';
    const body: any = { model, max_tokens: MAX_TOKENS, system: webOn ? systemFull + WEB_NOTE : systemFull, messages };
    if (webOn) body.tools = [{ type: WS_TOOL, name: 'web_search', max_uses: WS_MAX }];   // grounded answers with live web sources + citations
    const TRUNC = '\n\n---\n_⚠️ A válasz a hosszkorlát miatt megszakadt. Írd be, hogy **„folytasd"**._';

    // ---- Workflow (agentic) mode: Claude works autonomously across steps with file tools (item 4) ----
    if (mode === 'workflow') {
      if (!profRow || !profRow.can_workflows) return json({ error: 'A workflow-mód nincs engedélyezve ehhez a felhasználóhoz.' }, 403);
      // Optional: expose the org's Elicit MCP tools when the user is granted elicit_mcp AND the org is connected.
      let mcpServers: any[] | null = null;
      try {
        const { data: entMcp } = await sb.rpc('is_feature_enabled', { p_key: 'elicit_mcp' });
        if (entMcp === true) {
          const svcM = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
          const tok = await getOrgElicitToken(svcM);
          if (tok) mcpServers = [{ type: 'url', url: 'https://elicit.com/api/mcp', name: 'elicit', authorization_token: tok }];
        }
      } catch (_e) { /* MCP is best-effort; chat works without it */ }
      const wfHeaders = mcpServers ? { ...headers, 'anthropic-beta': 'mcp-client-2025-04-04' } : headers;
      const TOOLS = [
        { name: 'write_file', description: 'Create or overwrite a Markdown/text file in the session workspace.', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'short relative path e.g. plan.md' }, content: { type: 'string' } }, required: ['path', 'content'] } },
        { name: 'read_file', description: 'Read a file from the session workspace.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
        { name: 'list_files', description: 'List the files in the session workspace.', input_schema: { type: 'object', properties: {} } },
      ];
      const sysW = systemFull + ' You are in WORKFLOW mode: complete the task autonomously across multiple steps. Save every deliverable with write_file (Markdown); use list_files/read_file to inspect the workspace. Keep going until the task is done, then give a short summary of what you produced.';
      const convo: any[] = messages.slice();
      const steps: any[] = [];
      let finalText = '';
      for (let iter = 0; iter < 14; iter++) {
        const wfBody: any = { model, max_tokens: MAX_TOKENS, system: sysW, tools: TOOLS, messages: convo };
        if (mcpServers) wfBody.mcp_servers = mcpServers;
        const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: wfHeaders, body: JSON.stringify(wfBody) });
        const o = await r.json();
        if (o.error) return json({ error: 'anthropic: ' + (o.error.message || '') }, 502);
        const blocks = o.content || [];
        const tp = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
        if (tp) finalText = tp;
        if (o.stop_reason !== 'tool_use') break;
        convo.push({ role: 'assistant', content: blocks });
        const results: any[] = [];
        for (const b of blocks) {
          if (b.type !== 'tool_use') continue;
          let out = '';
          try {
            if (b.name === 'write_file') {
              const p = String(b.input.path || 'untitled.md').slice(0, 200), c = String(b.input.content || '');
              await sb.from('user_chat_files').upsert({ chat_id, path: p, content: c, source: 'agent', updated_at: new Date().toISOString() }, { onConflict: 'chat_id,path' });
              steps.push({ tool: 'write_file', path: p }); out = 'OK — saved ' + p;
            } else if (b.name === 'read_file') {
              const { data: f } = await sb.from('user_chat_files').select('content').eq('chat_id', chat_id).eq('path', String(b.input.path || '')).maybeSingle();
              steps.push({ tool: 'read_file', path: b.input.path }); out = f ? (f.content || '') : 'File not found';
            } else if (b.name === 'list_files') {
              const { data: fl } = await sb.from('user_chat_files').select('path').eq('chat_id', chat_id);
              steps.push({ tool: 'list_files' }); out = (fl || []).map((x: any) => x.path).join('\n') || '(empty)';
            }
          } catch (e) { out = 'error: ' + String(e); }
          results.push({ type: 'tool_result', tool_use_id: b.id, content: String(out).slice(0, 8000) });
        }
        convo.push({ role: 'user', content: results });
      }
      const wrote = steps.filter((s) => s.tool === 'write_file').map((s) => s.path);
      const summary = (wrote.length ? ('🛠 **Workflow kész** — ' + wrote.length + ' fájl: ' + wrote.join(', ') + '\n\n') : '') + (finalText || 'Kész.');
      await sb.from('user_chat_messages').insert({ chat_id, role: 'assistant', content: summary });
      await sb.from('user_chats').update({ updated_at: new Date().toISOString() }).eq('id', chat_id);
      return json({ ok: true, text: finalText, steps, files: wrote });
    }

    // ---- Multi-agent swarm mode: a Planner splits the task into angles, N Workers investigate them in parallel
    //      (web search when on), a Reviewer critiques, a Synthesizer streams the final answer — with LIVE per-agent
    //      lanes. Cost-heavy (1+N+1+1 Anthropic calls) → its OWN entitlement (research_agents; admin bypasses). ----
    if (mode === 'agents') {
      const agGate = await assertEntitled(sb, 'research_agents'); if (agGate) return agGate;
      // task = latest non-assistant message; a little prior context keeps the swarm on-thread
      let lastUserIdx = -1; for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].role !== 'assistant') { lastUserIdx = i; break; } }
      const task = String((rows[lastUserIdx] && rows[lastUserIdx].content) || rows[rows.length - 1].content).slice(0, 4000);
      const prior = rows.slice(Math.max(0, lastUserIdx - 4), lastUserIdx).map((m: any) => (m.role === 'assistant' ? 'Publify: ' : 'User: ') + String(m.content).slice(0, 500)).join('\n');
      const ctxShort = attachCtx ? ('\n' + attachCtx.slice(0, 8000)) : '';   // attachments as compact context for planner/workers
      const ctxFull = attachCtx ? ('\n' + attachCtx) : '';                    // the synthesizer grounds in the full attachments
      const webTool = () => (webOn ? [{ type: WS_TOOL, name: 'web_search', max_uses: WS_MAX }] : undefined);
      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          const send = (o: unknown) => { try { controller.enqueue(enc.encode(JSON.stringify(o) + '\n')); } catch { /* closed */ } };
          const allCitations: any[] = [];
          try {
            // PLANNER (non-streaming, quick)
            send({ t: 'status', a: 'plan', s: '🧭 Terv készítése…' });
            let angles: { label: string; brief: string }[] = [];
            try {
              const pr = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({ model: WORKER_MODEL, max_tokens: 500, system: [{ type: 'text', text: AG_PLANNER_SYS + ctxShort }], messages: [{ role: 'user', content: task }] }) });
              const pout = await pr.json();
              const ptext = (pout.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
              const mArr = ptext.match(/\[[\s\S]*\]/);
              if (mArr) { const arr = JSON.parse(mArr[0]); if (Array.isArray(arr)) angles = arr.filter((x: any) => x && x.label).map((x: any) => ({ label: String(x.label).slice(0, 60), brief: String(x.brief || x.label).slice(0, 300) })).slice(0, MAX_R); }
            } catch { /* fallback below */ }
            if (!angles.length) angles = [{ label: 'Fő vizsgálat', brief: task }];

            const roster = [
              ...angles.map((a, i) => ({ id: 'r' + i, role: 'researcher', label: a.label })),
              { id: 'rev', role: 'reviewer', label: 'Kritikus értékelés' },
              { id: 'syn', role: 'synth', label: 'Szintézis' },
            ];
            send({ t: 'plan', items: roster });

            // WORKERS (parallel)
            const findings = await Promise.all(angles.map(async (a, i) => {
              const id = 'r' + i;
              send({ t: 'start', a: id });
              const wBody: Record<string, unknown> = { model: WORKER_MODEL, max_tokens: 1600, system: [{ type: 'text', text: AG_WORKER_SYS + ctxShort }], messages: [{ role: 'user', content: `Assigned angle: ${a.label}\n${a.brief}\n\nUser's task: ${task}` }] };
              const wt = webTool(); if (wt) wBody.tools = wt;
              try {
                const res = await runSwarmAgent(headers, wBody, { onSearch: (q) => send({ t: 'status', a: id, s: '🌐 ' + q.slice(0, 60) }) });
                for (const c of res.citations) allCitations.push(c);
                send({ t: 'done', a: id, s: '✅ kész' + (res.citations.length ? ' · ' + res.citations.length + ' forrás' : '') });
                return { label: a.label, text: res.text };
              } catch (_e) { send({ t: 'done', a: id, s: '⚠️ hiba' }); return { label: a.label, text: '' }; }
            }));
            const findingsText = findings.filter((f) => f.text).map((f) => `### ${f.label}\n${f.text}`).join('\n\n') || '(a munkás-ágensek nem adtak vissza eredményt)';

            // REVIEWER
            send({ t: 'start', a: 'rev' });
            let critique = '';
            try {
              const rev = await runSwarmAgent(headers, { model: WORKER_MODEL, max_tokens: 1200, system: [{ type: 'text', text: AG_REVIEWER_SYS }], messages: [{ role: 'user', content: `Task: ${task}\n\nWorkers' findings:\n${findingsText}` }] }, {});
              critique = rev.text; send({ t: 'done', a: 'rev', s: '✅ kész' });
            } catch { send({ t: 'done', a: 'rev', s: '⚠️ hiba' }); }

            // SYNTHESIZER (streams the answer) — retry once, 2nd try falls back to the worker model; surface the real error.
            send({ t: 'start', a: 'syn' });
            const priorNote = prior ? `\n\nEarlier in the conversation:\n${prior}` : '';
            const synMsg = `Task: ${task}${priorNote}\n\nWorkers' findings:\n${findingsText}\n\nReviewer's critique:\n${critique || '(none)'}\n\nWrite the final grounded answer for the user.`;
            let answer = ''; let synErr = '';
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                const syn = await runSwarmAgent(headers, { model: attempt === 0 ? model : WORKER_MODEL, max_tokens: MAX_TOKENS, system: [{ type: 'text', text: AG_SYNTH_SYS + ctxFull, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: synMsg }] },
                  { onToken: (t) => { answer += t; send({ t: 'tok', d: t }); } });
                for (const c of syn.citations) allCitations.push(c);
                if (!answer) { answer = syn.text; if (answer) send({ t: 'tok', d: answer }); }
                break;
              } catch (e) { synErr = String(e); if (attempt === 0 && !answer) { send({ t: 'status', a: 'syn', s: '⚠️ újrapróbálás…' }); await new Promise((r) => setTimeout(r, 1500)); continue; } break; }
            }
            send({ t: 'done', a: 'syn', s: answer.trim() ? '✅ kész' : '⚠️ hiba' });

            // persist — never discard the swarm's work; fall back to the workers' findings if synth produced nothing
            let finalText = answer.trim();
            if (!finalText) {
              if (findings.some((f) => f.text)) finalText = 'ℹ️ A végső összegzés most nem készült el' + (synErr ? ' (' + synErr.slice(0, 140) + ')' : '') + ' — a munkás-ágensek eredményei:\n\n' + findingsText + (critique ? '\n\n---\n\n**Kritikus értékelés**\n\n' + critique : '');
              else finalText = '⚠️ Az ágensek most nem adtak vissza eredményt' + (synErr ? ' — ' + synErr.slice(0, 140) : '') + '. Próbáld újra, vagy küldd el Ágens-mód nélkül (a 🤖 gombbal kikapcsolva).';
              send({ t: 'tok', d: finalText });   // stream the fallback so the live bubble isn't left empty
            }
            let messageId: string | null = null;
            try {
              const { data: saved } = await sb.from('user_chat_messages').insert({ chat_id, role: 'assistant', content: finalText }).select('id').maybeSingle();
              messageId = saved?.id ?? null;
              await sb.from('user_chats').update({ updated_at: new Date().toISOString() }).eq('id', chat_id);
            } catch { /* persistence best-effort */ }
            send({ t: 'end', message_id: messageId });
            controller.close();
          } catch (e) { send({ t: 'err', m: String(e) }); try { controller.close(); } catch { /* */ } }
        },
      });
      return new Response(stream, { headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } });
    }

    if (wantStream) {
      const out = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          try {
            const sr = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }) });
            if (!sr.ok || !sr.body) {
              // model failed BEFORE streaming → persist the error so it doesn't vanish on the client's reload ("nothing happened")
              const detail = (await sr.text().catch(() => '')).slice(0, 300);
              const isCredit = /credit balance is too low|billing/i.test(detail);
              const hint = isCredit ? 'Az Anthropic API-fiók egyenlege elfogyott — tölts fel kreditet a console.anthropic.com → Plans & Billing oldalon. (Ez nem átmeneti hiba.)'
                : (sr.status === 429 || sr.status === 529) ? 'Ez átmeneti (túlterheltség/limit) — próbáld újra kicsit később.'
                : 'Ha ismétlődik, szólj az adminnak.';
              const errMsg = '⚠️ A modell most nem tudott válaszolni (' + sr.status + (detail ? ' — ' + detail.slice(0, 220) : '') + '). ' + hint;
              controller.enqueue(enc.encode(errMsg));
              try { await sb.from('user_chat_messages').insert({ chat_id, role: 'assistant', content: errMsg }); } catch { /* best-effort */ }
              controller.close(); return;
            }
            const reader = sr.body.getReader(); const dec = new TextDecoder();
            let buf = '', text = '', stop = '';
            // Live activity frames (␟{"s":…}␟) so the client can show what the model is doing — web search, which query, drafting.
            // Same protocol as research-chat; the client's parseStatus strips these frames from the visible answer.
            const sblocks: Record<number, any> = {};
            // Only emit frames when web search is on: that's where activity is worth showing (search takes seconds with no text),
            // and it keeps the plain web-off path byte-identical to before, so a stale cached client never sees raw ␟ frames.
            const emitStatus = (s: string) => { if (!webOn) return; try { controller.enqueue(enc.encode('␟' + JSON.stringify({ s }) + '␟')); } catch { /* stream may be closed */ } };
            for (;;) {
              const { done, value } = await reader.read(); if (done) break;
              buf += dec.decode(value, { stream: true });
              let nl: number;
              while ((nl = buf.indexOf('\n\n')) !== -1) {
                const piece = buf.slice(0, nl); buf = buf.slice(nl + 2);
                const dl = piece.split('\n').find((l) => l.startsWith('data:')); if (!dl) continue;
                const raw = dl.slice(5).trim(); if (!raw || raw === '[DONE]') continue;
                let ev: any; try { ev = JSON.parse(raw); } catch { continue; }
                if (ev.type === 'content_block_start') {
                  const bt = ev.content_block?.type; sblocks[ev.index] = ev.content_block || {};
                  if (bt === 'thinking' || bt === 'redacted_thinking') emitStatus('🧠 Gondolkodik a válaszon…');
                  else if (bt === 'server_tool_use' || bt === 'tool_use' || bt === 'mcp_tool_use') emitStatus(ev.content_block?.name === 'web_search' ? '🌐 Keresés a weben…' : '🔎 Eszköz futtatása…');
                  else if (bt === 'web_search_tool_result' || bt === 'mcp_tool_result' || bt === 'tool_result') emitStatus('📚 Találatok feldolgozása…');
                  else if (bt === 'text') emitStatus('✍️ Válasz megfogalmazása…');
                }
                else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') { text += ev.delta.text; controller.enqueue(enc.encode(ev.delta.text)); }
                else if (ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta' && typeof ev.delta.partial_json === 'string') { const b = sblocks[ev.index] || (sblocks[ev.index] = {}); b._pj = (b._pj || '') + ev.delta.partial_json; }
                else if (ev.type === 'content_block_stop') { const b = sblocks[ev.index]; if (b && b._pj) { try { const inp = JSON.parse(b._pj); const q = inp.query || inp.q; if (q) emitStatus('🔎 Keresés: „' + String(q).slice(0, 60) + '”'); } catch { /* partial json */ } } }
                else if (ev.type === 'message_delta' && ev.delta?.stop_reason) stop = ev.delta.stop_reason;
                else if (ev.type === 'error') controller.enqueue(enc.encode('\n\n[hiba: ' + (ev.error?.message || 'anthropic') + ']'));
              }
            }
            if (stop === 'max_tokens') { controller.enqueue(enc.encode(TRUNC)); text += TRUNC; }
            else if (stop === 'pause_turn') { const P = '\n\n---\n_⚠️ A webkeresés megszakadt (a modell szüneteltette a hosszú keresést). Írd be, hogy **„folytasd"**._'; controller.enqueue(enc.encode(P)); text += P; }
            try {
              await sb.from('user_chat_messages').insert({ chat_id, role: 'assistant', content: text || '(no text)' });
              await sb.from('user_chats').update({ updated_at: new Date().toISOString() }).eq('id', chat_id);
            } catch { /* best-effort */ }
            controller.close();
          } catch (e) { try { controller.enqueue(new TextEncoder().encode('\n\n[hiba: ' + String(e) + ']')); } catch { /* */ } controller.close(); }
        },
      });
      return new Response(out, { headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' } });
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
    const o = await r.json();
    if (o.error) return json({ error: 'anthropic: ' + (o.error.message || '') }, 502);
    let text = (o.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
    if (o.stop_reason === 'max_tokens') text += TRUNC;
    const { data: saved } = await sb.from('user_chat_messages').insert({ chat_id, role: 'assistant', content: text || '(no text)' }).select('id').maybeSingle();
    await sb.from('user_chats').update({ updated_at: new Date().toISOString() }).eq('id', chat_id);
    return json({ ok: true, message_id: saved?.id, model, usage: o.usage });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
