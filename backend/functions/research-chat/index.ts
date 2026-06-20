// Publify — Research Chat Edge Function (R5b).
// A Claude session in the Ideas tab that talks to Consensus via the Anthropic MCP connector
// (remote MCP server https://mcp.consensus.app/mcp). The Anthropic + Consensus credentials live
// only here (Edge secrets). It loads the chat history under the CALLER's JWT (RLS), runs one Claude
// turn with the Consensus MCP attached, then persists the assistant message + the raw tool blocks +
// best-effort evidence — so the app OWNS and can reuse everything discussed with Consensus.
//
// Deploy:  supabase functions deploy research-chat
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//          supabase secrets set CONSENSUS_MCP_TOKEN=<bearer token from consensus.app>
//          (optional) supabase secrets set RESEARCH_AI_MODEL=claude-opus-4-8
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CONSENSUS_TOKEN = Deno.env.get('CONSENSUS_MCP_TOKEN');
const CONSENSUS_MCP_URL = Deno.env.get('CONSENSUS_MCP_URL') || 'https://mcp.consensus.app/mcp';
const MODEL = Deno.env.get('RESEARCH_AI_MODEL') || 'claude-sonnet-4-6';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SYSTEM =
`You are a research-ideation partner inside a PhD research platform. Help the user discover and sharpen
concrete, testable research questions. Use the Consensus tools to ground every non-trivial claim in
peer-reviewed evidence, and cite the papers you rely on. When you propose research questions, make them
specific and falsifiable, and say briefly why each is a gap worth pursuing. Be concise.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503);
    if (!CONSENSUS_TOKEN) return json({ error: 'CONSENSUS_MCP_TOKEN not set' }, 503);
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { chat_id } = await req.json().catch(() => ({}));
    if (!chat_id) return json({ error: 'chat_id required' }, 400);

    // history (RLS: only succeeds if the caller can read this chat's project)
    const { data: chat } = await sb.from('research_chats').select('id,project_id').eq('id', chat_id).maybeSingle();
    if (!chat) return json({ error: 'chat not found or no access' }, 404);
    const { data: proj } = await sb.from('research_projects').select('title,field,goal,keywords').eq('id', chat.project_id).maybeSingle();
    const { data: history } = await sb.from('research_messages').select('role,content').eq('chat_id', chat_id).order('created_at', { ascending: true });

    const ctx = proj ? `\n\nCurrent project — Title: ${proj.title}; Field: ${proj.field ?? '—'}; Goal: ${proj.goal ?? '—'}; Keywords: ${(proj.keywords ?? []).join(', ')}` : '';
    const messages = (history || []).filter((m) => m.content).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
    if (!messages.length) return json({ error: 'no messages to respond to' }, 400);

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04', 'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL, max_tokens: 2000, system: SYSTEM + ctx, messages,
        mcp_servers: [{ type: 'url', url: CONSENSUS_MCP_URL, name: 'consensus', authorization_token: CONSENSUS_TOKEN }],
      }),
    });
    const out = await r.json();
    if (out.error) return json({ error: 'anthropic: ' + (out.error.message || JSON.stringify(out.error)) }, 502);

    const blocks: any[] = out.content || [];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

    // persist the assistant turn (with the raw blocks) under the caller's JWT
    const { data: saved, error: smErr } = await sb.from('research_messages')
      .insert({ chat_id, role: 'assistant', content: text || '(no text)', blocks }).select('id').maybeSingle();
    if (smErr) return json({ error: 'persist failed: ' + smErr.message }, 403);

    // best-effort evidence capture: one row per Consensus tool result (raw kept in blocks regardless)
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

    return json({ ok: true, message_id: saved?.id, evidence: ev.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
