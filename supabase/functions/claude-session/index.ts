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
const SYSTEM = `You are Claude, a helpful, knowledgeable assistant inside the Publify platform. Answer clearly and concisely in the user's language. Use Markdown; put code in fenced code blocks.`;
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
    const { chat_id, stream: wantStream } = await req.json().catch(() => ({}));
    if (!chat_id) return json({ error: 'chat_id required' }, 400);

    const { data: chat } = await sb.from('user_chats').select('id').eq('id', chat_id).maybeSingle();
    if (!chat) return json({ error: 'chat not found or no access' }, 404);
    const { data: ures } = await sb.auth.getUser();
    const uid = (ures && ures.user && ures.user.id) || '';
    const { data: profRow } = await sb.from('profiles').select('ai_model').eq('id', uid).maybeSingle();
    const model = (profRow && profRow.ai_model && ALLOWED_MODELS.has(profRow.ai_model)) ? profRow.ai_model : MODEL;

    const { data: history } = await sb.from('user_chat_messages').select('role,content').eq('chat_id', chat_id).order('created_at', { ascending: true });
    let rows = (history || []).filter((m: any) => m.content);
    if (rows.length > HISTORY) rows = rows.slice(-HISTORY);
    if (!rows.length) return json({ error: 'no messages to respond to' }, 400);
    const messages = rows.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const headers: Record<string, string> = { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    const body = { model, max_tokens: MAX_TOKENS, system: SYSTEM, messages };
    const TRUNC = '\n\n---\n_⚠️ A válasz a hosszkorlát miatt megszakadt. Írd be, hogy **„folytasd"**._';

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
