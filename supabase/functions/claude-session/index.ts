// Publify — Claude Session Edge Function. A plain, full Claude chat (Zola-style), independent of research
// projects. Loads a user_chats conversation under the CALLER's JWT (RLS = owner-only), streams one reply,
// persists it. Uses the caller's per-user model (profiles.ai_model). No MCP, no project context.
//
// Deploy:  supabase functions deploy claude-session --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('RESEARCH_AI_MODEL') || 'claude-sonnet-4-6';
const ALLOWED_MODELS = new Set(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
const MAX_TOKENS = parseInt(Deno.env.get('SESSION_MAX_TOKENS') || '4096', 10);
const HISTORY = parseInt(Deno.env.get('SESSION_HISTORY') || '20', 10);
const SYSTEM = `You are Publify, a helpful, knowledgeable research assistant inside the Publify platform. You help researchers with their writing, publications, and projects. Answer clearly and concisely in the user's language. Use Markdown; put code in fenced code blocks. When the user has attached documents, LaTeX/research projects, or publications, ground your answers in them and cite which attachment you used.`;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503);
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { chat_id, stream: wantStream, mode } = await req.json().catch(() => ({}));
    if (!chat_id) return json({ error: 'chat_id required' }, 400);

    const { data: chat } = await sb.from('user_chats').select('id').eq('id', chat_id).maybeSingle();
    if (!chat) return json({ error: 'chat not found or no access' }, 404);
    const { data: ures } = await sb.auth.getUser();
    const uid = (ures && ures.user && ures.user.id) || '';
    const { data: profRow } = await sb.from('profiles').select('ai_model,can_workflows').eq('id', uid).maybeSingle();
    const model = (profRow && profRow.ai_model && ALLOWED_MODELS.has(profRow.ai_model)) ? profRow.ai_model : MODEL;

    const { data: history } = await sb.from('user_chat_messages').select('role,content').eq('chat_id', chat_id).order('created_at', { ascending: true });
    let rows = (history || []).filter((m: any) => m.content);
    if (rows.length > HISTORY) rows = rows.slice(-HISTORY);
    if (!rows.length) return json({ error: 'no messages to respond to' }, 400);
    const messages = rows.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    // Attached materials (uploads / LaTeX & research projects / publications) → injected as context so Publify
    // "sees" them in normal chat too. Agent-written workspace files are excluded (workflow tools read those).
    const { data: filesData } = await sb.from('user_chat_files').select('path,content,source').eq('chat_id', chat_id).order('path');
    let attachCtx = '';
    if (filesData && filesData.length) {
      let budget = 60000; const parts: string[] = [];
      for (const f of (filesData as any[])) {
        if (f.source === 'agent') continue;
        const c = String(f.content || ''); if (!c) continue;
        const chunk = `### ${f.path}\n${c.slice(0, 24000)}`;
        if (budget - chunk.length < 0) { parts.push(`### ${f.path}\n_(túl nagy — kihagyva a kontextusból)_`); continue; }
        budget -= chunk.length; parts.push(chunk);
      }
      if (parts.length) attachCtx = '\n\n# Csatolt anyagok\nA felhasználó az alábbi dokumentumokat / projekteket / publikációkat csatolta. Használd őket, ha relevánsak, és jelezd, melyikre támaszkodtál.\n\n' + parts.join('\n\n---\n\n');
    }
    const systemFull = SYSTEM + attachCtx;

    const headers: Record<string, string> = { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    const body = { model, max_tokens: MAX_TOKENS, system: systemFull, messages };
    const TRUNC = '\n\n---\n_⚠️ A válasz a hosszkorlát miatt megszakadt. Írd be, hogy **„folytasd"**._';

    // ---- Workflow (agentic) mode: Claude works autonomously across steps with file tools (item 4) ----
    if (mode === 'workflow') {
      if (!profRow || !profRow.can_workflows) return json({ error: 'A workflow-mód nincs engedélyezve ehhez a felhasználóhoz.' }, 403);
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
        const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system: sysW, tools: TOOLS, messages: convo }) });
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

    if (wantStream) {
      const out = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          try {
            const sr = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }) });
            if (!sr.ok || !sr.body) { controller.enqueue(enc.encode('\n\n[hiba: ' + (await sr.text()).slice(0, 300) + ']')); controller.close(); return; }
            const reader = sr.body.getReader(); const dec = new TextDecoder();
            let buf = '', text = '', stop = '';
            for (;;) {
              const { done, value } = await reader.read(); if (done) break;
              buf += dec.decode(value, { stream: true });
              let nl: number;
              while ((nl = buf.indexOf('\n\n')) !== -1) {
                const piece = buf.slice(0, nl); buf = buf.slice(nl + 2);
                const dl = piece.split('\n').find((l) => l.startsWith('data:')); if (!dl) continue;
                const raw = dl.slice(5).trim(); if (!raw || raw === '[DONE]') continue;
                let ev: any; try { ev = JSON.parse(raw); } catch { continue; }
                if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') { text += ev.delta.text; controller.enqueue(enc.encode(ev.delta.text)); }
                else if (ev.type === 'message_delta' && ev.delta?.stop_reason) stop = ev.delta.stop_reason;
                else if (ev.type === 'error') controller.enqueue(enc.encode('\n\n[hiba: ' + (ev.error?.message || 'anthropic') + ']'));
              }
            }
            if (stop === 'max_tokens') { controller.enqueue(enc.encode(TRUNC)); text += TRUNC; }
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
