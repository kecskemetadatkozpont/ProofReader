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
//          supabase secrets set RESEARCH_MAX_TOKENS=800                (output cap per reply; default 800)
//          supabase secrets set RESEARCH_HISTORY=12                    (last N messages sent; default 12)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CONSENSUS_TOKEN = Deno.env.get('CONSENSUS_MCP_TOKEN');
const CONSENSUS_MCP_URL = Deno.env.get('CONSENSUS_MCP_URL') || 'https://mcp.consensus.app/mcp';
const MODEL = Deno.env.get('RESEARCH_AI_MODEL') || 'claude-sonnet-4-6';
const MAX_TOKENS = parseInt(Deno.env.get('RESEARCH_MAX_TOKENS') || '800', 10);
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
    const { chat_id } = await req.json().catch(() => ({}));
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
    const SYSTEM = persona + mcpNote + ATTACH_NOTE;

    const headers: Record<string, string> = { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    if (useMcp) headers['anthropic-beta'] = 'mcp-client-2025-04-04';
    const body: Record<string, unknown> = { model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM + ctx, messages };
    if (useMcp) body.mcp_servers = [{ type: 'url', url: CONSENSUS_MCP_URL, name: 'consensus', authorization_token: CONSENSUS_TOKEN }];

    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
    const out = await r.json();
    if (out.error) return json({ error: 'anthropic: ' + (out.error.message || JSON.stringify(out.error)) }, 502);

    const blocks: any[] = out.content || [];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
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

    return json({ ok: true, version: 'attach-v4', message_id: saved?.id, evidence: ev.length, mode: useMcp ? 'consensus' : 'plain', model: MODEL, usage: out.usage, dbg });
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
