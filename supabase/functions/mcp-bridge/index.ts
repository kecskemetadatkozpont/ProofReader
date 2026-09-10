// Publify — MCP Bridge Edge Function (course module, P0).
// The SINGLE audited gateway for course-lab AI/MCP calls. Every request passes the same
// gate chain (feature entitlement → course membership → lab mcp_profile contract →
// atomic credit debit) and every branch — success, error, denied — writes an mcp_call_log
// row with the SERVICE client (students cannot forge or delete audit rows; the table has
// no INSERT policy for authenticated). Forked from research-chat's streaming skeleton.
//
// Request:  { course_id, assignment_id, provider: 'anthropic'|'gemini-image', messages, stream }
//   Provider names are CANONICAL ('anthropic' | 'gemini-image'); the legacy aliases
//   ('anthropic-mcp', 'gemini') are normalized on arrival — defense on both sides.
//   - 'anthropic'    → Anthropic Messages API; model = resolveCourseModel() capped at the
//                      lab's mcp_profile.model_max; optional MCP connector servers from
//                      mcp_profile.servers (anthropic-beta: mcp-client-2025-11-20 +
//                      mcp_toolset allowed_tools filtering) and the code execution tool
//                      when mcp_profile.code_execution is true.
//                      SSE stream = TYPED events, one "data: {json}\n\n" line each:
//                        {type:'text_delta',text} | {type:'tool_use',name,input?} |
//                        {type:'tool_result',name?,preview?} | finally ALWAYS
//                        {type:'done',call_log_id,credits,model,service[,audit_warning,warnings]}
//                        — on failure {type:'error',message} instead of done.
//   - 'gemini-image' → Gemini REST Imagen (non-stream); the base64 image is uploaded to
//                      the course-media bucket (<course_id>/<user_id>/<ts>.png) and JSON
//                      {ok:true, media_path, mime:'image/png', model, credits, call_log_id}
//                      is returned (canvas item / submission provenance).
//   Success-path audit inserts are AWAITED (.select('id').single()) so call_log_id can be
//   returned; denied/error audit rows stay best-effort. Instructors/demonstrators
//   (course_role RPC) are exempt from debit/refund (credits=0 in the log).
//
// Deploy:  supabase functions deploy mcp-bridge
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//          supabase secrets set GEMINI_API_KEY=...                       (image lab weeks)
//          supabase secrets set CONSENSUS_MCP_TOKEN=<bearer>             (optional — Consensus MCP)
//          supabase secrets set HIGGSFIELD_MCP_URL=... HIGGSFIELD_MCP_TOKEN=...  (optional — if/when public)
//   COST:  supabase secrets set COURSE_MAX_TOKENS=4096                   (output cap per reply)
//          supabase secrets set GEMINI_IMAGE_MODEL=imagen-4.0-generate-001
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertEntitled, assertCourseMember, clampModel, resolveCourseModel } from '../_shared/entitlement.ts';
import { logAiCost } from '../_shared/aicost.ts';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_IMAGE_MODEL = Deno.env.get('GEMINI_IMAGE_MODEL') || 'imagen-4.0-generate-001';
const MAX_TOKENS = parseInt(Deno.env.get('COURSE_MAX_TOKENS') || '4096', 10);
const HISTORY = parseInt(Deno.env.get('COURSE_HISTORY') || '20', 10);   // last N messages sent upstream

// Remote MCP servers the bridge knows how to wire up. Tokens live ONLY here (Edge secrets);
// students never see a key. A server named in the lab profile but without a resolvable URL
// (e.g. Higgsfield before a public remote MCP endpoint exists) is silently skipped — the
// plan's P0 decision: the image/video line goes through Gemini, Higgsfield is pluggable later.
const MCP_REGISTRY: Record<string, { url: string | null; token: string | null }> = {
  consensus: { url: Deno.env.get('CONSENSUS_MCP_URL') || 'https://mcp.consensus.app/mcp', token: Deno.env.get('CONSENSUS_MCP_TOKEN') || null },
  higgsfield: { url: Deno.env.get('HIGGSFIELD_MCP_URL') || null, token: Deno.env.get('HIGGSFIELD_MCP_TOKEN') || null },
};

// Canonical provider names are 'anthropic' and 'gemini-image'. The client maps its legacy
// names before sending, and the bridge normalizes the incoming value with the SAME map
// (contract: protection on both sides) BEFORE any gate runs.
const PROVIDER_MAP: Record<string, string> = {
  'anthropic-mcp': 'anthropic',
  'gemini': 'gemini-image',
};

// The plan's mcp_profile examples use 'anthropic-mcp' / 'gemini' — accept those as aliases
// so instructor-authored profiles keep working with the P0 request-side provider names.
const PROVIDER_ALIASES: Record<string, string[]> = {
  'anthropic': ['anthropic', 'anthropic-mcp'],
  'gemini-image': ['gemini-image', 'gemini'],
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    // service client: writes the tamper-proof audit rows, refunds credits, uploads media
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { course_id, assignment_id, provider: rawProvider, messages, stream: wantStream } = await req.json().catch(() => ({}));
    // normalize to the canonical provider name BEFORE any gate runs ('anthropic-mcp'→'anthropic', 'gemini'→'gemini-image')
    const provider = typeof rawProvider === 'string' ? (PROVIDER_MAP[rawProvider] || rawProvider) : rawProvider;
    if (!course_id || !assignment_id || !provider) return json({ error: 'course_id, assignment_id and provider required' }, 400);

    // (1) feature gate + (2) course gate — fail-closed, BEFORE any DB write or debit
    const gate1 = await assertEntitled(sb, 'course_mcp'); if (gate1) return gate1;
    const gate2 = await assertCourseMember(sb, course_id); if (gate2) return gate2;
    const { data: ures } = await sb.auth.getUser();
    const callerUid: string = (ures && ures.user && ures.user.id) || '';

    // (3) the lab's MCP contract — loaded under the CALLER's JWT (RLS: students only see visible labs)
    const { data: asg } = await sb.from('lab_assignments').select('id,course_id,mcp_profile').eq('id', assignment_id).eq('course_id', course_id).maybeSingle();
    if (!asg) return json({ error: 'assignment not found or not visible' }, 404);
    const profile: any = (asg.mcp_profile && typeof asg.mcp_profile === 'object') ? asg.mcp_profile : {};

    const prompt = lastUserPrompt(messages);
    const baseLog = { course_id, assignment_id, user_id: callerUid, provider, prompt };
    const logCall = (row: Record<string, unknown>) => svc.from('mcp_call_log').insert({ ...baseLog, ...row }).then(() => {}, () => { /* denied/error audit insert is best-effort; never crash the response path */ });
    // SUCCESS-path audit insert: awaited, returns the log row id so the client gets
    // call_log_id (provenance). If the insert fails, the call result still goes back,
    // but flagged with audit_warning.
    const logOk = async (row: Record<string, unknown>): Promise<{ call_log_id: string | null; audit_warning?: string }> => {
      const { data, error } = await svc.from('mcp_call_log').insert({ ...baseLog, ...row }).select('id').single();
      if (error || !data) {
        console.error('mcp_call_log insert failed:', (error && error.message) || 'no row returned');
        return { call_log_id: null, audit_warning: 'Az audit-naplózás nem sikerült — a hívás eredménye érvényes, de nincs call_log_id.' };
      }
      return { call_log_id: data.id as string };
    };

    const allowedProviders: string[] = Array.isArray(profile.providers) ? profile.providers : [];
    const aliases = PROVIDER_ALIASES[provider] || [provider];
    if (!aliases.some((a) => allowedProviders.includes(a))) {
      // denied attempts are audit events too
      await logCall({ server: null, tool: null, model: null, params: { requested_provider: provider }, credits: 0, status: 'denied_tool' });
      return json({ error: 'Ez a labor nem engedélyezi ezt a szolgáltatót.' }, 403);
    }
    if (provider !== 'anthropic' && provider !== 'gemini-image') {
      await logCall({ server: null, tool: null, model: null, params: { requested_provider: provider, reason: 'no P0 adapter' }, credits: 0, status: 'denied_tool' });
      return json({ error: 'Ez a szolgáltató még nem érhető el a hídon keresztül.' }, 403);
    }

    // input validation BEFORE debit (no pointless debit/refund round-trip)
    let rows: any[] = (Array.isArray(messages) ? messages : [])
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
      .map((m: any) => ({ role: m.role, content: m.content }));
    if (rows.length > HISTORY) rows = rows.slice(-HISTORY);                       // cap input tokens
    while (rows.length && rows[0].role !== 'user') rows.shift();                  // API requires a user-first turn
    if (provider === 'anthropic' && !rows.length) {
      await logCall({ server: null, tool: null, model: null, params: null, credits: 0, status: 'error' });
      return json({ error: 'messages required' }, 400);
    }
    if (provider === 'gemini-image' && !prompt) {
      await logCall({ server: null, tool: 'generate_image', model: GEMINI_IMAGE_MODEL, params: null, credits: 0, status: 'error' });
      return json({ error: 'prompt (last user message) required' }, 400);
    }

    // (3b) second line of defense: per-user daily AI-call ceiling (migration-48
    // ai_over_budget RPC) BEFORE the debit; a missing RPC degrades to "not over" (no-op)
    const { data: overBudget } = await sb.rpc('ai_over_budget', { max_calls: parseInt(Deno.env.get('AI_DAILY_CALLS') || '200', 10) });
    if (overBudget === true) {
      await logCall({ server: null, tool: null, model: null, params: { reason: 'ai_over_budget' }, credits: 0, status: 'denied_quota' });
      return json({ error: 'Elérted a napi hívás-plafont.' }, 429);
    }

    // (3c) instructor/demonstrator (course_role RPC): NO per-student budget row → the
    // credit debit AND refund are skipped for them; the audit rows log credits=0
    const { data: courseRole } = await sb.rpc('course_role', { cid: course_id });
    const isStaff = courseRole === 'oktato' || courseRole === 'demonstrator';

    // (3d) MCP servers from the lab profile — computed BEFORE the debit so the fail-closed
    // allowlist 403 never costs credits. SECURITY: any conf.url in the profile is IGNORED
    // (token-exfiltration guard) — only servers whose NAME is in MCP_REGISTRY are wired,
    // always with the registry's own url+token pair. Unknown names → skipped + warning.
    // A server entry without a non-empty allowed_tools is fail-closed: NOT wired.
    const betas: string[] = [];
    const tools: any[] = [];
    const mcpServers: any[] = [];
    const serverNames: string[] = [];
    const mcpWarnings: string[] = [];
    if (provider === 'anthropic') {
      const servers: any = (profile.servers && typeof profile.servers === 'object') ? profile.servers : {};
      let skippedNoAllowlist = 0;
      for (const [name, conf] of Object.entries(servers) as [string, any][]) {
        const reg = MCP_REGISTRY[name];
        if (!reg) { mcpWarnings.push('Ismeretlen MCP szerver kihagyva: ' + name); continue; }
        if (!reg.url) { mcpWarnings.push('Az MCP szerverhez nincs elérhető végpont, kihagyva: ' + name); continue; }
        const allowed: string[] = (Array.isArray(conf?.allowed_tools) ? conf.allowed_tools : []).filter((t: any) => typeof t === 'string' && t);
        if (!allowed.length) {
          skippedNoAllowlist++;
          mcpWarnings.push('MCP szerver kihagyva (hiányzó/üres allowed_tools): ' + name);
          continue;
        }
        const entry: any = { type: 'url', url: reg.url, name };
        if (reg.token) entry.authorization_token = reg.token;
        mcpServers.push(entry);
        serverNames.push(name);
        // allowlist mode: everything off, only the lab's tools on — the student really
        // only reaches e.g. generate_image in week 7, never confirm_billing_purchase
        tools.push({
          type: 'mcp_toolset', mcp_server_name: name,
          default_config: { enabled: false },
          configs: allowed.map((t: string) => ({ name: t, enabled: true })),
        });
      }
      if (skippedNoAllowlist > 0 && !mcpServers.length) {
        await logCall({ server: null, tool: null, model: null, params: { reason: 'allowed_tools missing' }, credits: 0, status: 'denied_tool' });
        return json({ error: 'A laborprofil allowed_tools nélkül érvénytelen — szólj az oktatónak.' }, 403);
      }
      if (mcpServers.length) betas.push('mcp-client-2025-11-20');
      if (profile.code_execution === true) {
        betas.push('code-execution-2025-08-25');
        tools.push({ type: 'code_execution_20260521', name: 'code_execution' });
      }
    }

    // (4) atomic credit debit BEFORE the provider call — cost from the lab's credit_cost map;
    // instructors/demonstrators skip it entirely (charged stays 0)
    const costs: any = (profile.credit_cost && typeof profile.credit_cost === 'object') ? profile.credit_cost : {};
    const service = provider === 'gemini-image' ? 'image' : 'llm';
    const credits = provider === 'gemini-image' ? Number(costs.generate_image ?? 5) : Number(costs.llm_call ?? 1);
    let charged = 0;
    if (!isStaff) {
      const { data: debited, error: debErr } = await sb.rpc('course_credit_debit', { p_course: course_id, p_service: service, p_amount: credits });
      if (debErr || debited !== true) {
        await logCall({ server: null, tool: provider === 'gemini-image' ? 'generate_image' : null, model: null, params: { service }, credits: 0, status: 'denied_quota' });
        return json({ error: 'Elfogyott a kreditkereted ehhez a szolgáltatáshoz — kérj keretemelést az oktatótól.' }, 429);
      }
      charged = credits;
    }
    // refund on error/empty result — ONLY the service client may call this RPC (review fix
    // in migration-67); no-op when nothing was debited (staff)
    const refund = () => charged === 0
      ? Promise.resolve()
      : svc.rpc('course_credit_refund', { p_course: course_id, p_user: callerUid, p_service: service, p_amount: charged }).then(() => {}, () => {});
    // per-user daily counter bump (pairs with ai_over_budget) — fire-and-forget on success
    const bumpUsage = () => sb.rpc('ai_usage_bump').then(() => {}, () => {});

    // ---------------- provider adapter: gemini-image (non-stream JSON) ----------------
    if (provider === 'gemini-image') {
      if (!GEMINI_KEY) {
        await refund();
        await logCall({ server: null, tool: 'generate_image', model: GEMINI_IMAGE_MODEL, params: null, credits: 0, status: 'error' });
        return json({ error: 'GEMINI_API_KEY not set' }, 503);
      }
      const t0 = Date.now();
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:predict`, {
        method: 'POST',
        headers: { 'x-goog-api-key': GEMINI_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1 } }),
      });
      const out: any = await r.json().catch(() => ({}));
      const pred = Array.isArray(out?.predictions) ? out.predictions[0] : null;
      const b64: string | null = (pred && (pred.bytesBase64Encoded || pred?.image?.imageBytes)) || null;
      if (!r.ok || !b64) {
        await refund();
        await logCall({ server: null, tool: 'generate_image', model: GEMINI_IMAGE_MODEL, params: { sampleCount: 1 }, response_meta: { duration_ms: Date.now() - t0, error: String(out?.error?.message || r.status).slice(0, 300) }, credits: 0, status: 'error' });
        return json({ error: 'gemini: ' + (out?.error?.message || ('HTTP ' + r.status)) }, 502);
      }
      // (6) media → course-media bucket with the service client, path-scoped to <course_id>/<user_id>/
      const path = `${course_id}/${callerUid}/${Date.now()}.png`;
      const { error: upErr } = await svc.storage.from('course-media').upload(path, b64ToBytes(b64), { contentType: 'image/png' });
      if (upErr) {
        await refund();
        await logCall({ server: null, tool: 'generate_image', model: GEMINI_IMAGE_MODEL, params: { sampleCount: 1 }, response_meta: { duration_ms: Date.now() - t0, error: ('upload: ' + upErr.message).slice(0, 300) }, credits: 0, status: 'error' });
        return json({ error: 'media upload failed: ' + upErr.message }, 502);
      }
      const { call_log_id, audit_warning } = await logOk({ server: null, tool: 'generate_image', model: GEMINI_IMAGE_MODEL, params: { sampleCount: 1 }, response_meta: { duration_ms: Date.now() - t0, media_paths: [path] }, credits: charged, status: 'ok' });
      bumpUsage();
      return json({ ok: true, media_path: path, mime: 'image/png', model: GEMINI_IMAGE_MODEL, credits: charged, call_log_id, ...(audit_warning ? { audit_warning } : {}) });
    }

    // ---------------- provider adapter: anthropic (stream or JSON) ----------------
    if (!ANTHROPIC_KEY) {
      await refund();
      await logCall({ server: null, tool: null, model: null, params: null, credits: 0, status: 'error' });
      return json({ error: 'ANTHROPIC_API_KEY not set' }, 503);
    }

    // model: course policy (student_model / instructor's own), capped at the lab's model_max;
    // the cap itself is clamped against the caller's allowlist (fail-safe downgrade)
    let model = await resolveCourseModel(sb, course_id);
    if (typeof profile.model_max === 'string' && profile.model_max && modelTier(model) > modelTier(profile.model_max)) {
      model = await clampModel(sb, profile.model_max);
    }

    // (MCP servers/tools were wired pre-debit — see (3d) above: registry-only URLs,
    // fail-closed allowed_tools; mcpWarnings ride along in the done event / JSON)
    const headers: Record<string, string> = { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    if (betas.length) headers['anthropic-beta'] = betas.join(',');
    const body: Record<string, unknown> = { model, max_tokens: MAX_TOKENS, messages: rows };
    if (mcpServers.length) body.mcp_servers = mcpServers;
    if (tools.length) body.tools = tools;

    const callParams = { mcp_servers: serverNames, code_execution: profile.code_execution === true, max_tokens: MAX_TOKENS };
    const serverField = serverNames.length ? serverNames.join(',') : null;
    const t0 = Date.now();

    // ---- Streaming path: TYPED SSE events per the contract, one "data: {json}\n\n" line
    //      each — {type:'text_delta',text} | {type:'tool_use',name,input?} |
    //      {type:'tool_result',name?,preview?} | finally ALWAYS {type:'done',...}
    //      (on failure {type:'error',message} instead) — then audit-log with call_log_id. ----
    if (wantStream) {
      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          const send = (obj: Record<string, unknown>) => controller.enqueue(enc.encode('data: ' + JSON.stringify(obj) + '\n\n'));
          try {
            const sr = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }) });
            if (!sr.ok || !sr.body) {
              const errTxt = (await sr.text()).slice(0, 300);
              send({ type: 'error', message: errTxt });
              await refund();
              await logCall({ server: serverField, tool: null, model, params: callParams, response_meta: { duration_ms: Date.now() - t0, error: errTxt }, credits: 0, status: 'error' });
              controller.close(); return;
            }
            const reader = sr.body.getReader(); const dec = new TextDecoder();
            const sblocks: any[] = []; let buf = ''; let tokIn = 0; let tokOut = 0;
            const toolNameById: Record<string, string> = {};                       // tool_use id → name (for tool_result labels)
            let upstreamError = false;
            for (;;) {
              const { done, value } = await reader.read(); if (done) break;
              buf += dec.decode(value, { stream: true });
              let nl: number;
              while ((nl = buf.indexOf('\n\n')) !== -1) {
                const piece = buf.slice(0, nl); buf = buf.slice(nl + 2);
                const dl = piece.split('\n').find((l) => l.startsWith('data:')); if (!dl) continue;
                const raw = dl.slice(5).trim(); if (!raw || raw === '[DONE]') continue;
                let ev: any; try { ev = JSON.parse(raw); } catch { continue; }
                if (ev.type === 'message_start') { tokIn = ev.message?.usage?.input_tokens || 0; }
                else if (ev.type === 'content_block_start') {
                  const b = JSON.parse(JSON.stringify(ev.content_block || {}));
                  if (b.type === 'text' && b.text == null) b.text = '';
                  sblocks[ev.index] = b;
                  // surface tool activity so the lab UI shows what the model is doing
                  if (typeof b.type === 'string' && (b.type === 'mcp_tool_use' || b.type === 'server_tool_use' || b.type === 'tool_use')) {
                    if (typeof b.id === 'string' && typeof b.name === 'string') toolNameById[b.id] = b.name;
                    send({ type: 'tool_use', name: b.name || b.type });
                  }
                }
                else if (ev.type === 'content_block_delta') {
                  const d = ev.delta || {};
                  if (d.type === 'text_delta' && typeof d.text === 'string') { if (!sblocks[ev.index]) sblocks[ev.index] = { type: 'text', text: '' }; sblocks[ev.index].text = (sblocks[ev.index].text || '') + d.text; send({ type: 'text_delta', text: d.text }); }
                  else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') { if (!sblocks[ev.index]) sblocks[ev.index] = {}; sblocks[ev.index]._pj = (sblocks[ev.index]._pj || '') + d.partial_json; }
                }
                else if (ev.type === 'content_block_stop') {
                  const b = sblocks[ev.index];
                  if (b && b._pj) { try { b.input = JSON.parse(b._pj); } catch { /* keep partial */ } delete b._pj; }
                  // forward finished tool-result blocks (MCP results, code execution output)
                  if (b && typeof b.type === 'string' && b.type.endsWith('tool_result')) {
                    const preview = toolResultText(b).slice(0, 2000);
                    const rn = (typeof b.tool_use_id === 'string' && toolNameById[b.tool_use_id]) || undefined;
                    send({ type: 'tool_result', ...(rn ? { name: rn } : {}), ...(preview ? { preview } : {}) });
                  }
                }
                else if (ev.type === 'message_delta') { if (ev.usage && typeof ev.usage.output_tokens === 'number') tokOut = ev.usage.output_tokens; }
                else if (ev.type === 'message_stop') { logAiCost(sb, { fn: 'mcp-bridge', model, input: tokIn, output: tokOut }); }   // streaming: tokens come from the SSE frames
                else if (ev.type === 'error') { upstreamError = true; send({ type: 'error', message: (ev.error && ev.error.message) || 'anthropic' }); }
              }
            }
            const cleanBlocks = sblocks.filter(Boolean);
            if (!cleanBlocks.length || upstreamError) {
              // empty result / upstream error event → refund, audit as error, error event instead of done
              await refund();
              await logCall({ server: serverField, tool: null, model, params: callParams, response_meta: { duration_ms: Date.now() - t0, error: upstreamError ? 'upstream error event' : 'empty result' }, credits: 0, status: 'error' });
              if (!upstreamError) send({ type: 'error', message: 'üres válasz — a kredit visszatérítve' });
            } else {
              const { call_log_id, audit_warning } = await logOk({ server: serverField, tool: null, model, params: callParams, response_meta: { tokens: { input: tokIn, output: tokOut }, duration_ms: Date.now() - t0 }, credits: charged, status: 'ok' });
              bumpUsage();
              send({
                type: 'done', call_log_id, credits: charged, model, service,
                ...(audit_warning ? { audit_warning } : {}),
                ...(mcpWarnings.length ? { warnings: mcpWarnings } : {}),
              });
            }
            controller.close();
          } catch (e) {
            try { send({ type: 'error', message: String(e).slice(0, 300) }); } catch { /* */ }
            await refund();
            await logCall({ server: serverField, tool: null, model, params: callParams, response_meta: { duration_ms: Date.now() - t0, error: String(e).slice(0, 300) }, credits: 0, status: 'error' });
            controller.close();
          }
        },
      });
      return new Response(stream, { headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } });
    }

    // ---- Non-streaming path ----
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
    const out: any = await r.json().catch(() => ({}));
    logAiCost(sb, { fn: 'mcp-bridge', model, usage: out.usage });
    const blocks: any[] = Array.isArray(out?.content) ? out.content : [];
    if (!r.ok || out?.error || !blocks.length) {
      await refund();
      const errMsg = String(out?.error?.message || (blocks.length ? 'anthropic' : 'empty result')).slice(0, 300);
      await logCall({ server: serverField, tool: null, model, params: callParams, response_meta: { duration_ms: Date.now() - t0, error: errMsg }, credits: 0, status: 'error' });
      return json({ error: 'anthropic: ' + errMsg }, 502);
    }
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const { call_log_id, audit_warning } = await logOk({
      server: serverField, tool: null, model, params: callParams,
      response_meta: { tokens: { input: out.usage?.input_tokens || 0, output: out.usage?.output_tokens || 0 }, duration_ms: Date.now() - t0 },
      credits: charged, status: 'ok',
    });
    bumpUsage();
    return json({
      ok: true, text, blocks, model, usage: out.usage, credits: charged, call_log_id, service,
      ...(audit_warning ? { audit_warning } : {}),
      ...(mcpWarnings.length ? { warnings: mcpWarnings } : {}),
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

// Last user message FULL text — the provenance prompt stored in mcp_call_log.
function lastUserPrompt(messages: any): string {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'user' || !m.content) continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      return m.content.filter((b: any) => b && b.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n');
    }
  }
  return '';
}

// Compact text rendering of a finished tool-result block (MCP / code execution) for the stream.
function toolResultText(b: any): string {
  try {
    if (b.type === 'bash_code_execution_tool_result' || b.type === 'code_execution_tool_result') {
      const c = b.content || {};
      return [c.stdout, c.stderr].filter(Boolean).join('\n').trim();
    }
    const c = Array.isArray(b.content) ? b.content : [b.content];
    return c.map((item: any) => (item?.text ?? (typeof item === 'string' ? item : JSON.stringify(item)))).filter(Boolean).join('\n').trim();
  } catch { return ''; }
}

// Coarse model tier for capping at the lab's model_max (haiku < sonnet < opus).
function modelTier(id: string): number {
  if (typeof id !== 'string') return 1;
  if (id.includes('haiku')) return 0;
  if (id.includes('sonnet')) return 1;
  if (id.includes('opus')) return 2;
  return 1;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
