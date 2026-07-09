// Publify — Elicit MCP OAuth connector (Phase 4, org-level). An admin connects the org's Elicit
// account ONCE; the token is stored SERVICE-ROLE-ONLY (elicit_mcp_org, migration-53) and used by
// claude-session to expose Elicit's MCP tools via Anthropic's MCP connector.
//
// OAuth 2.0 authorization_code + PKCE (S256) + dynamic client registration, per the discovery at
// https://elicit.com/api/auth/.well-known/oauth-authorization-server.
//
// POST { action:'start' }      (admin JWT) → registers the client if needed, returns { authorize_url }
// GET  ?code&state             (browser redirect from Elicit) → exchanges the code, stores tokens, HTML
// POST { action:'status' }     (admin JWT) → { connected, expires_at }
// POST { action:'disconnect' } (admin JWT) → clears the tokens
//
// Deploy: supabase functions deploy elicit-oauth --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const AUTH_BASE = Deno.env.get('ELICIT_AUTH_BASE') || 'https://elicit.com/api/auth';
const MCP_RESOURCE = Deno.env.get('ELICIT_MCP_URL') || 'https://elicit.com/api/mcp';
const AUTHZ_EP = AUTH_BASE + '/oauth/auth';
const TOKEN_EP = AUTH_BASE + '/oauth/token';
const REGISTER_EP = AUTH_BASE + '/register';
const SCOPE = 'elicit.mcp';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const htmlPage = (title: string, msg: string, ok: boolean) => new Response(
  `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<body style="font-family:system-ui,-apple-system,sans-serif;background:#f5f7f8;color:#172029;display:grid;place-items:center;height:100vh;margin:0">` +
  `<div style="max-width:420px;text-align:center;padding:24px"><div style="font-size:46px;margin-bottom:12px">${ok ? '✅' : '⚠️'}</div>` +
  `<h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="color:#55636f;line-height:1.5">${msg}</p>` +
  `<a href="Admin.html" style="display:inline-block;margin-top:16px;background:#0e7490;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">Back to Admin</a></div></body>`,
  { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
);

function b64url(buf: ArrayBuffer): string {
  let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randToken(n = 32): string { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a.buffer); }
async function pkce() { const verifier = randToken(48); const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)); return { verifier, challenge: b64url(d) }; }

function redirectUri(): string { return Deno.env.get('SUPABASE_URL')! + '/functions/v1/elicit-oauth'; }

async function ensureAdmin(req: Request, svc: any): Promise<string | null> {
  const auth = req.headers.get('Authorization') || '';
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: ures } = await anon.auth.getUser();
  const uid = ures?.user?.id; if (!uid) return null;
  const { data: prof } = await svc.from('profiles').select('role').eq('id', uid).maybeSingle();
  return prof?.role === 'admin' ? uid : null;
}

// register a public (PKCE) OAuth client via dynamic client registration; returns client_id
async function ensureClient(svc: any): Promise<string> {
  const { data: org } = await svc.from('elicit_mcp_org').select('client_id').eq('id', 1).maybeSingle();
  if (org?.client_id) return org.client_id;
  const r = await fetch(REGISTER_EP, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Publify', redirect_uris: [redirectUri()],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none', scope: SCOPE,
    }),
  });
  const o = await r.json().catch(() => ({}));
  if (!r.ok || !o.client_id) throw new Error('client registration failed: ' + (o.error || r.status));
  await svc.from('elicit_mcp_org').update({ client_id: o.client_id, updated_at: new Date().toISOString() }).eq('id', 1);
  return o.client_id;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // ---- OAuth callback (browser redirect from Elicit) ----
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const code = u.searchParams.get('code'), state = u.searchParams.get('state'), oerr = u.searchParams.get('error');
    if (oerr) return htmlPage('Elicit connection failed', 'Elicit returned: ' + oerr, false);
    if (!code || !state) return htmlPage('Elicit connection failed', 'Missing code/state in the callback.', false);
    const { data: pend } = await svc.from('elicit_mcp_pending').select('*').eq('state', state).maybeSingle();
    if (!pend) return htmlPage('Elicit connection failed', 'Unknown or expired authorization state.', false);
    try {
      const r = await fetch(TOKEN_EP, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: pend.redirect_uri || redirectUri(), client_id: pend.client_id, code_verifier: pend.code_verifier }),
      });
      const o = await r.json().catch(() => ({}));
      if (!r.ok || !o.access_token) return htmlPage('Elicit connection failed', 'Token exchange failed: ' + (o.error_description || o.error || r.status), false);
      await svc.from('elicit_mcp_org').update({
        access_token: o.access_token, refresh_token: o.refresh_token || null,
        expires_at: new Date(Date.now() + (o.expires_in || 3600) * 1000).toISOString(),
        scope: o.scope || SCOPE, connected_by: pend.admin_id || null, connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', 1);
      await svc.from('elicit_mcp_pending').delete().eq('state', state);
      return htmlPage('Elicit connected', 'Your organization’s Elicit account is now linked. Grant "Elicit tools in Chat (MCP)" to users in Admin → Feature permissions.', true);
    } catch (e) { return htmlPage('Elicit connection failed', String(e), false); }
  }

  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const uid = await ensureAdmin(req, svc);
    if (!uid) return json({ error: 'admin only' }, 403);
    const { action } = await req.json().catch(() => ({}));

    if (action === 'status') {
      const { data: org } = await svc.from('elicit_mcp_org').select('access_token,expires_at,connected_by,connected_at,client_id').eq('id', 1).maybeSingle();
      return json({ ok: true, connected: !!(org && org.access_token), expires_at: org?.expires_at || null, connected_at: org?.connected_at || null, has_client: !!(org && org.client_id) });
    }
    if (action === 'disconnect') {
      await svc.from('elicit_mcp_org').update({ access_token: null, refresh_token: null, expires_at: null, connected_by: null, connected_at: null, updated_at: new Date().toISOString() }).eq('id', 1);
      return json({ ok: true });
    }
    if (action === 'start') {
      let clientId: string;
      try { clientId = await ensureClient(svc); } catch (e) { return json({ error: String(e) }, 502); }
      const { verifier, challenge } = await pkce();
      const state = randToken(24);
      await svc.from('elicit_mcp_pending').insert({ state, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri(), admin_id: uid });
      // best-effort cleanup of stale pending rows (>15 min)
      await svc.from('elicit_mcp_pending').delete().lt('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString());
      const p = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri(), scope: SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256' });
      return json({ ok: true, authorize_url: AUTHZ_EP + '?' + p.toString() });
    }
    return json({ error: 'unknown action' }, 400);
  } catch (e) { return json({ error: String(e) }, 500); }
});
