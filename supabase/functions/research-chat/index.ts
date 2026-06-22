// Publify — Research Chat Edge Function (R5b).
// A Claude session in the Ideas tab. If CONSENSUS_MCP_TOKEN is set it talks to Consensus via the
// Anthropic MCP connector (https://mcp.consensus.app/mcp) for evidence-grounded answers; if not, it
// falls back to a plain Claude chat. Credentials live only here (Edge secrets). Loads the chat history
// under the CALLER's JWT (RLS), runs one turn, then persists the assistant message + raw tool blocks +
// best-effort evidence — so the app OWNS and can reuse everything discussed.
//
// Deploy:  supabase functions deploy research-chat
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//          supabase secrets set CONSENSUS_MCP_TOKEN=<bearer>           (optional — enables Consensus)
//   COST:  supabase secrets set RESEARCH_AI_MODEL=claude-haiku-4-5-20251001   (cheapest; default sonnet)
//          supabase secrets set RESEARCH_MAX_TOKENS=8192               (output cap per reply; default 4096)
//          supabase secrets set RESEARCH_HISTORY=12                    (last N messages sent; default 12)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CONSENSUS_TOKEN = Deno.env.get('CONSENSUS_MCP_TOKEN');
const CONSENSUS_MCP_URL = Deno.env.get('CONSENSUS_MCP_URL') || 'https://mcp.consensus.app/mcp';
const MODEL = Deno.env.get('RESEARCH_AI_MODEL') || 'claude-sonnet-4-6';
// admins assign a per-user model (profiles.ai_model); validate against this whitelist before trusting it
const ALLOWED_MODELS = new Set(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
const MAX_TOKENS = parseInt(Deno.env.get('RESEARCH_MAX_TOKENS') || '4096', 10);  // long answers were cut at 800 (stop_reason=max_tokens)
const HISTORY = parseInt(Deno.env.get('RESEARCH_HISTORY') || '12', 10);
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
    const useMcp = !!CONSENSUS_TOKEN;
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { chat_id, stream: wantStream } = await req.json().catch(() => ({}));
    if (!chat_id) return json({ error: 'chat_id required' }, 400);

    const { data: chat } = await sb.from('research_chats').select('id,project_id').eq('id', chat_id).maybeSingle();
    if (!chat) return json({ error: 'chat not found or no access' }, 404);
    const { data: ures } = await sb.auth.getUser();
    const callerUid: string = (ures && ures.user && ures.user.id) || '';
    // service client for reading attachment files (caller-JWT storage RLS is unreliable; we path-guard instead)
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: proj } = await sb.from('research_projects').select('title,field,goal,keywords').eq('id', chat.project_id).maybeSingle();
    const { data: history } = await sb.from('research_messages').select('role,content,attachments').eq('chat_id', chat_id).order('created_at', { ascending: true });
    // the caller's own editable system prompt (seeded per researcher; editable in Profile → Chat prompt)
    const { data: spRow } = await sb.from('research_system_prompts').select('prompt').eq('user_id', callerUid).maybeSingle();
    const userPrompt = ((spRow && spRow.prompt) || '').trim();
    // per-user model assigned by an admin (profiles.ai_model); fall back to the env default if unset/invalid
    const { data: profRow } = await sb.from('profiles').select('ai_model').eq('id', callerUid).maybeSingle();
    const userModel = (profRow && profRow.ai_model && ALLOWED_MODELS.has(profRow.ai_model)) ? profRow.ai_model : MODEL;

    const ctx = proj ? `\n\nCurrent project — Title: ${proj.title}; Field: ${proj.field ?? '—'}; Goal: ${proj.goal ?? '—'}; Keywords: ${(proj.keywords ?? []).join(', ')}` : '';
    let rows: any[] = (history || []).filter((m: any) => m.content);
    if (rows.length > HISTORY) rows = rows.slice(-HISTORY);                          // cap input tokens
    if (!rows.length) return json({ error: 'no messages to respond to' }, 400);
    let lastUserIdx = -1;
    for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].role !== 'assistant') { lastUserIdx = i; break; } }
    const dbg: any = {};
    const messages: any[] = [];
    for (let i = 0; i < rows.length; i++) {
      const m: any = rows[i], role = m.role === 'assistant' ? 'assistant' : 'user';
      let atts: any = m.attachments;
      if (typeof atts === 'string') { try { atts = JSON.parse(atts); } catch { atts = null; } }   // robustness if jsonb arrives as text
      if (i === lastUserIdx) { dbg.attType = typeof m.attachments; dbg.attCount = Array.isArray(atts) ? atts.length : 0; }
      // attachments only on the most recent user turn (keeps cost bounded)
      if (i === lastUserIdx && Array.isArray(atts) && atts.length) { const c = await buildBlocks(sb, svc, atts, m.content, dbg, { projectId: chat.project_id, uid: callerUid }); dbg.blocks = c.length; messages.push({ role, content: c }); }
      else messages.push({ role, content: m.content });
    }

    const ATTACH_NOTE = ` When the user attaches sources or files, their full content is included directly in this message (as text and document blocks) — read and use that content, and never say you cannot access attachments or files.`;
    // the researcher's own persona drives the chat when present; otherwise a sensible default
    const BASE = `You are a research-ideation partner inside a PhD platform. Propose specific, falsifiable research questions with brief rationale, surface gaps, and be concise.`;
    const persona = userPrompt || BASE;
    const mcpNote = useMcp ? ` Use the Consensus tools to ground every non-trivial claim in peer-reviewed evidence, and cite the papers.` : '';
    const FILE_NOTE = ` You can save a file into the project's file browser by emitting a fenced block in EXACTLY this form (the opening line is \`\`\`file: followed by a short descriptive relative path, nothing else on that line):\n\`\`\`file:lit-review.md\n<the full file content>\n\`\`\`\nDo this whenever the user asks you to write something to a file, create/save a document, or produce an artifact (a literature summary, a research plan, a draft section, notes). Prefer .md. Keep a short normal reply too, but put the document itself inside the file block — only emit a file block when a saved file is actually wanted.`;
    const SYSTEM = persona + mcpNote + ATTACH_NOTE + FILE_NOTE;

    const headers: Record<string, string> = { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    if (useMcp) headers['anthropic-beta'] = 'mcp-client-2025-04-04';
    const body: Record<string, unknown> = { model: userModel, max_tokens: MAX_TOKENS, system: SYSTEM + ctx, messages };
    if (useMcp) body.mcp_servers = [{ type: 'url', url: CONSENSUS_MCP_URL, name: 'consensus', authorization_token: CONSENSUS_TOKEN }];

    // ---- Streaming path: forward Claude's text deltas to the browser live, rebuild the full block list
    //      from the SSE events, then persist the message + evidence once the stream finishes. ----
    if (wantStream) {
      const TRUNC = '\n\n---\n_⚠️ A válasz a hosszkorlát miatt megszakadt. Írd be, hogy **„folytasd"**, és a bot folytatja onnan._';
      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          try {
            const sr = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }) });
            if (!sr.ok || !sr.body) { controller.enqueue(enc.encode('\n\n[hiba: ' + (await sr.text()).slice(0, 300) + ']')); controller.close(); return; }
            const reader = sr.body.getReader(); const dec = new TextDecoder();
            const sblocks: any[] = []; let stopReason = ''; let buf = '';
            for (;;) {
              const { done, value } = await reader.read(); if (done) break;
              buf += dec.decode(value, { stream: true });
              let nl: number;
              while ((nl = buf.indexOf('\n\n')) !== -1) {
                const piece = buf.slice(0, nl); buf = buf.slice(nl + 2);
                const dl = piece.split('\n').find((l) => l.startsWith('data:')); if (!dl) continue;
                const raw = dl.slice(5).trim(); if (!raw || raw === '[DONE]') continue;
                let ev: any; try { ev = JSON.parse(raw); } catch { continue; }
                if (ev.type === 'content_block_start') { const b = JSON.parse(JSON.stringify(ev.content_block || {})); if (b.type === 'text' && b.text == null) b.text = ''; sblocks[ev.index] = b; }
                else if (ev.type === 'content_block_delta') {
                  const d = ev.delta || {};
                  if (d.type === 'text_delta' && typeof d.text === 'string') { if (!sblocks[ev.index]) sblocks[ev.index] = { type: 'text', text: '' }; sblocks[ev.index].text = (sblocks[ev.index].text || '') + d.text; controller.enqueue(enc.encode(d.text)); }
                  else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') { if (!sblocks[ev.index]) sblocks[ev.index] = {}; sblocks[ev.index]._pj = (sblocks[ev.index]._pj || '') + d.partial_json; }
                }
                else if (ev.type === 'content_block_stop') { const b = sblocks[ev.index]; if (b && b._pj) { try { b.input = JSON.parse(b._pj); } catch { /* keep partial */ } delete b._pj; } }
                else if (ev.type === 'message_delta') { if (ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason; }
                else if (ev.type === 'error') { controller.enqueue(enc.encode('\n\n[hiba: ' + ((ev.error && ev.error.message) || 'anthropic') + ']')); }
              }
            }
            const cleanBlocks = sblocks.filter(Boolean);
            let text = cleanBlocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
            if (stopReason === 'max_tokens') { controller.enqueue(enc.encode(TRUNC)); text += TRUNC; }
            // persist + evidence — best-effort, never fail the already-delivered stream
            try {
              const { data: saved } = await sb.from('research_messages').insert({ chat_id, role: 'assistant', content: text || '(no text)', blocks: cleanBlocks }).select('id').maybeSingle();
              const ev2: any[] = []; let lastQuery: string | null = null;
              for (const b of cleanBlocks) {
                if (b.type === 'mcp_tool_use') lastQuery = typeof b.input === 'object' ? (b.input.query || b.input.q || JSON.stringify(b.input)) : String(b.input);
                if (b.type === 'mcp_tool_result') { const c = Array.isArray(b.content) ? b.content : [b.content]; for (const item of c) { const snip = item?.text ?? (typeof item === 'string' ? item : JSON.stringify(item)); if (snip) ev2.push({ chat_id, message_id: saved?.id ?? null, query: lastQuery, snippet: String(snip).slice(0, 4000) }); } }
              }
              if (ev2.length) await sb.from('research_evidence').insert(ev2);
            } catch { /* persistence is best-effort here */ }
            controller.close();
          } catch (e) { try { controller.enqueue(enc.encode('\n\n[hiba: ' + String(e) + ']')); } catch { /* */ } controller.close(); }
        },
      });
      return new Response(stream, { headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } });
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
    const out = await r.json();
    if (out.error) return json({ error: 'anthropic: ' + (out.error.message || JSON.stringify(out.error)) }, 502);

    const blocks: any[] = out.content || [];
    let text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    // If the model ran out of output budget, don't leave a silent mid-sentence stop — tell the user.
    if (out.stop_reason === 'max_tokens') text += '\n\n---\n_⚠️ A válasz a hosszkorlát miatt megszakadt. Írd be, hogy **„folytasd"**, és a bot folytatja onnan._';
    const { data: saved, error: smErr } = await sb.from('research_messages')
      .insert({ chat_id, role: 'assistant', content: text || '(no text)', blocks }).select('id').maybeSingle();
    if (smErr) return json({ error: 'persist failed: ' + smErr.message }, 403);

    const ev: any[] = [];
    let lastQuery: string | null = null;
    for (const b of blocks) {
      if (b.type === 'mcp_tool_use') lastQuery = typeof b.input === 'object' ? (b.input.query || b.input.q || JSON.stringify(b.input)) : String(b.input);
      if (b.type === 'mcp_tool_result') {
        const c = Array.isArray(b.content) ? b.content : [b.content];
        for (const item of c) {
          const snip = item?.text ?? (typeof item === 'string' ? item : JSON.stringify(item));
          if (snip) ev.push({ chat_id, message_id: saved?.id ?? null, query: lastQuery, snippet: String(snip).slice(0, 4000) });
        }
      }
    }
    if (ev.length) await sb.from('research_evidence').insert(ev);

    return json({ ok: true, version: 'attach-v4', message_id: saved?.id, evidence: ev.length, mode: useMcp ? 'consensus' : 'plain', model: userModel, usage: out.usage, dbg });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf); let bin = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  return btoa(bin);
}

// Concatenate a LaTeX project's TEXT files (tex/bib/…) in load order, skipping binaries (images/PDFs are
// stored as dataURL/storagePath and have no .content). Caps at ~220KB so a big thesis can't blow the budget.
function thesisText(data: any): string {
  if (!data || !data.files) return '';
  const TEXT: Record<string, number> = { tex: 1, bib: 1, bbl: 1, bst: 1, cls: 1, sty: 1, md: 1, txt: 1 };
  const order: string[] = Array.isArray(data.order) && data.order.length ? data.order : Object.keys(data.files);
  let out = '';
  for (const p of order) {
    const f = data.files[p];
    if (!f || !TEXT[f.type] || !f.content) continue;
    out += `\n% ==================== FILE: ${p} ====================\n${f.content}\n`;
    if (out.length > 240000) break;
  }
  return out.slice(0, 220000).trim();
}

// Expand attachments into Claude content blocks (text + PDF document). dbg collects per-item outcomes.
// Files are read with the SERVICE client but path-guarded to the caller's own scope (their uid for
// publication-files, the chat's project for research-data) so a crafted path can't reach others' files.
async function buildBlocks(sb: any, svc: any, atts: any[], content: string, dbg: any, scope: { projectId: string; uid: string }): Promise<any[]> {
  const blocks: any[] = [{ type: 'text', text: content }];
  dbg.items = [];
  let n = 0;
  for (const a of atts) {
    if (n >= 5) break;
    try {
      if (a.kind === 'source' && a.source_id) {
        const { data: s, error } = await sb.from('research_sources').select('title,abstract,year,venue').eq('id', a.source_id).maybeSingle();
        dbg.items.push({ kind: 'source', ok: !!s, err: error?.message });
        if (s) { blocks.push({ type: 'text', text: `[Attached source: ${s.title} (${s.year ?? ''}${s.venue ? ', ' + s.venue : ''})]\n${(s.abstract ?? '').slice(0, 6000)}` }); n++; }
      } else if (a.kind === 'project' && a.project_id) {
        // a LaTeX editor project (thesis) — the projects-table RLS lets the caller read their own/shared
        // row under their JWT, so no service client; we extract the combined .tex/.bib text, not the raw json.
        const { data: proj, error } = await sb.from('projects').select('id,title,data').eq('id', a.project_id).maybeSingle();
        dbg.items.push({ kind: 'project', ok: !!proj, err: error?.message });
        if (proj && proj.data) {
          const txt = thesisText(proj.data);
          if (txt) { blocks.push({ type: 'text', text: `[Attached LaTeX publication: ${proj.title ?? a.title ?? 'thesis'}]\n\n${txt}` }); n++; }
        }
      } else if (a.kind === 'projectfile' && a.file_id) {
        // a file from the project's file browser (research_files) — RLS lets the caller read their project's rows
        const { data: rf, error } = await sb.from('research_files').select('path,content').eq('id', a.file_id).maybeSingle();
        dbg.items.push({ kind: 'projectfile', ok: !!rf, err: error?.message });
        if (rf && rf.content != null) { blocks.push({ type: 'text', text: `[Attached project file: ${rf.path}]\n\n${String(rf.content).slice(0, 100000)}` }); n++; }
      } else if (a.kind === 'file' && a.bucket && a.path) {
        const seg0 = String(a.path).split('/')[0];
        const allowed = (a.bucket === 'publication-files' && seg0 === scope.uid) || (a.bucket === 'research-data' && seg0 === scope.projectId);
        if (!allowed) { dbg.items.push({ kind: 'file', bucket: a.bucket, ok: false, err: 'path outside caller scope' }); continue; }
        const { data: blob, error } = await svc.storage.from(a.bucket).download(a.path);   // service read, path-guarded above
        dbg.items.push({ kind: 'file', bucket: a.bucket, ok: !!blob, err: error?.message });
        if (!blob) continue;
        const buf = await blob.arrayBuffer();
        const mime = a.mime || '';
        if (mime.includes('pdf')) {
          if (buf.byteLength <= 8_000_000) { blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toB64(buf) } }); n++; }
          else blocks.push({ type: 'text', text: `[Attached "${a.name}" skipped — PDF over 8 MB]` });
        } else if (mime.startsWith('text') || /\.(csv|txt|md|json)$/i.test(a.name || '')) {
          const txt = new TextDecoder().decode(new Uint8Array(buf));
          blocks.push({ type: 'text', text: `[Attached file: ${a.name}]\n${txt.slice(0, 20000)}` }); n++;
        } else {
          blocks.push({ type: 'text', text: `[Attached "${a.name}" (${mime}) — type not readable inline]` });
        }
      }
    } catch (e) { dbg.items.push({ kind: a.kind, ok: false, err: String(e).slice(0, 140) }); }
  }
  return blocks;
}
