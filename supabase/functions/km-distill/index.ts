// Publify — Memory Layer distiller (km-distill).
// Turns completed research_protocol_steps into knowledge-graph nodes/edges (migration-45).
// Two passes per step: (1) DETERMINISTIC — nodes/edges straight from the structured spec/result
// columns, no LLM; (2) CLAUDE — schema-constrained entity/relation extraction from the free-text
// report/summary. Every new node is embedded with the built-in gte-small model (384-dim) so the
// whole thing stays on the Claude + Supabase line (no external embedding API).
//
// Runs as a platform job (like the protocol runner): reads/writes with the service role, stamping
// each node's project_id/created_by from the source step. Drains steps where status='done' and
// km_ingested_at is null; the migration's trigger re-nulls that marker when a result is edited.
//
// Deploy:  supabase functions deploy km-distill
// Secrets: ANTHROPIC_API_KEY (shared with research-chat) · KM_CRON_SECRET (for pg_cron/manual cron)
//   opt:   KM_MODEL=claude-sonnet-4-6 (default) · KM_BATCH=8
//
// Invoke (admin, from the Memory page "Sync" button, with the user JWT):
//   POST { limit?: number, project_id?: uuid, step_id?: uuid }
// Invoke (cron / service): add header  x-km-secret: <KM_CRON_SECRET>
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// deno-lint-ignore no-explicit-any
declare const Supabase: any;   // Supabase Edge runtime built-in (gte-small inference); absent in local type-check

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const KM_MODEL = Deno.env.get('KM_MODEL') || 'claude-sonnet-4-6';
const ALLOWED_MODELS = new Set(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
const MODEL = ALLOWED_MODELS.has(KM_MODEL) ? KM_MODEL : 'claude-sonnet-4-6';
const BATCH = Math.min(parseInt(Deno.env.get('KM_BATCH') || '8', 10) || 8, 25);
const CRON_SECRET = Deno.env.get('KM_CRON_SECRET') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-km-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---- vocabulary (mirror of km_ontology) ----
const NODE_KINDS = new Set(['result', 'finding', 'method', 'dataset', 'metric', 'artifact', 'tool', 'hypothesis', 'paper', 'entity']);
const EDGE_RELS = new Set(['uses', 'produces', 'measures', 'supports', 'contradicts', 'derived_from', 'evaluates', 'cites', 'related_to']);

function norm(t: string): string {
  return (t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}
function clip(s: unknown, n: number): string { return String(s ?? '').slice(0, n); }
function vecLiteral(v: number[]): string { return '[' + v.map((x) => (Number.isFinite(x) ? x : 0)).join(',') + ']'; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // ---- authorize: admin JWT (UI "Sync" button) OR the cron secret header ----
    const secret = req.headers.get('x-km-secret') || '';
    let authorized = !!(CRON_SECRET && secret && secret === CRON_SECRET);
    let actor: string | null = null;
    if (!authorized) {
      const auth = req.headers.get('Authorization') || '';
      const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
      const { data: ures } = await anon.auth.getUser();
      const uid = ures?.user?.id;
      if (uid) {
        const { data: prof } = await svc.from('profiles').select('role').eq('id', uid).maybeSingle();
        if (prof?.role === 'admin') { authorized = true; actor = uid; }
      }
    }
    if (!authorized) return json({ error: 'admin or cron secret required' }, 403);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(parseInt(String(body.limit ?? BATCH), 10) || BATCH, 1), 25);

    // optional: scope a re-sync to one project (resolve its protocol ids)
    let protoFilter: string[] | null = null;
    if (body.project_id) {
      const { data: pp } = await svc.from('research_protocols').select('id').eq('project_id', body.project_id);
      protoFilter = (pp || []).map((x: any) => x.id);
      if (!protoFilter.length) return json({ ok: true, steps_processed: 0, nodes: 0, edges: 0, note: 'no protocols for that project' });
    }

    // ---- fetch the batch of un-ingested completed steps ----
    let q = svc.from('research_protocol_steps')
      .select('id,protocol_id,ord,title,kind,spec,result,assignee,status,km_ingested_at')
      .eq('status', 'done');
    if (body.step_id) q = q.eq('id', body.step_id);
    else q = q.is('km_ingested_at', null);
    if (protoFilter) q = q.in('protocol_id', protoFilter);
    q = q.order('finished_at', { ascending: true }).limit(limit);
    const { data: steps, error: stepErr } = await q;
    if (stepErr) return json({ error: stepErr.message }, 500);
    if (!steps || !steps.length) return json({ ok: true, steps_processed: 0, nodes: 0, edges: 0, note: 'nothing to ingest' });

    // resolve each step → protocol → project (id, owner)
    const protIds = [...new Set(steps.map((s: any) => s.protocol_id).filter(Boolean))];
    const { data: prots } = await svc.from('research_protocols').select('id,project_id,title').in('id', protIds);
    const protById: Record<string, any> = {}; (prots || []).forEach((p: any) => { protById[p.id] = p; });
    const projIds = [...new Set((prots || []).map((p: any) => p.project_id).filter(Boolean))];
    const { data: projs } = await svc.from('research_projects').select('id,owner_id,title').in('id', projIds);
    const projById: Record<string, any> = {}; (projs || []).forEach((p: any) => { projById[p.id] = p; });

    // gte-small session (built-in edge inference). If unavailable, nodes still store (embedding null).
    let session: any = null;
    try { session = new Supabase.ai.Session('gte-small'); } catch (_e) { session = null; }
    async function embed(text: string): Promise<number[] | null> {
      if (!session) return null;
      try {
        const out = await session.run(clip(text, 4000), { mean_pool: true, normalize: true });
        // gte-small returns number[] today, but tolerate a typed array (Float32Array) too
        return Array.isArray(out) ? out : (ArrayBuffer.isView(out) ? Array.from(out as any) : null);
      } catch (_e) { return null; }
    }

    let nNodes = 0, nEdges = 0, nSteps = 0, nLlmFail = 0, nFailed = 0, nEmbed = 0;
    // cap gte-small inferences per invocation — the model is memory-heavy in the edge runtime and
    // embedding dozens of nodes in one call hits WORKER_RESOURCE_LIMIT. Uncapped nodes still store
    // (FTS-searchable); pair this with small per-call batches (the Sync button drains one step at a time).
    const EMBED_CAP = parseInt(Deno.env.get('KM_EMBED_CAP') || '30', 10);
    const t0 = Date.now();

    for (const step of steps) {
      if (Date.now() - t0 > 50000) break;   // stay under the edge wall-clock; the rest re-drains next run
      const prot = protById[step.protocol_id];
      const proj = prot ? projById[prot.project_id] : null;
      if (!proj) { // orphan (deleted project) — mark ingested so we don't loop
        await svc.from('research_protocol_steps').update({ km_ingested_at: new Date().toISOString() }).eq('id', step.id);
        continue;
      }
      const projectId = proj.id, createdBy = proj.owner_id || null, protocolId = prot.id;
      const spec = step.spec || {}, result = step.result || {};
      const summary = clip(result.summary || '', 4000);
      const report = clip(result.report || '', 12000);
      const nodeCache: Record<string, string> = {};   // key `kind|norm` → node id (also resolves edge endpoints)

      async function upsertNode(kind: string, title: string, opts: { body?: string; source?: string; props?: any } = {}): Promise<string | null> {
        if (!NODE_KINDS.has(kind)) kind = 'entity';
        const t = clip(title, 240).trim(); if (!t) return null;
        const nt = norm(t); const key = kind + '|' + nt;
        if (nodeCache[key]) return nodeCache[key];
        const row = {
          kind, title: t, norm_title: nt, body: opts.body ? clip(opts.body, 6000) : null,
          project_id: projectId, protocol_id: protocolId, step_id: step.id,
          source_kind: opts.source || null, props: opts.props || {}, created_by: createdBy, updated_at: new Date().toISOString(),
        };
        const { data, error } = await svc.from('km_nodes').upsert(row, { onConflict: 'project_id,kind,norm_title' }).select('id').maybeSingle();
        if (error || !data) return null;
        nodeCache[key] = data.id; nNodes++;
        if (nEmbed < EMBED_CAP) {
          const v = await embed(t + '. ' + (opts.body || ''));
          if (v && v.length === 384) { await svc.from('km_embeddings').upsert({ node_id: data.id, embedding: vecLiteral(v), project_id: projectId, model: 'gte-small', dim: 384 }, { onConflict: 'node_id' }); nEmbed++; }
        }
        return data.id;
      }
      async function addEdge(sourceId: string | null, targetId: string | null, rel: string, evidence?: string) {
        if (!sourceId || !targetId || sourceId === targetId) return;
        if (!EDGE_RELS.has(rel)) rel = 'related_to';
        const { error } = await svc.from('km_edges').upsert(
          { source_id: sourceId, target_id: targetId, rel, project_id: projectId, step_id: step.id, created_by: createdBy, evidence: evidence ? clip(evidence, 500) : null },
          { onConflict: 'source_id,target_id,rel', ignoreDuplicates: true });
        if (!error) nEdges++;
      }

      // ---------- pass 1: deterministic (no LLM) ----------
      const resultId = await upsertNode('result', step.title || ('Step ' + step.ord), { body: summary || clip(report, 1200), source: 'result' });
      // metrics {name: value}
      const metrics = (result.metrics && typeof result.metrics === 'object' && !Array.isArray(result.metrics)) ? result.metrics : {};
      for (const k of Object.keys(metrics).slice(0, 30)) {
        const mid = await upsertNode('metric', k, { source: 'result.metrics', props: { value: metrics[k] } });
        await addEdge(resultId, mid, 'produces');
      }
      // inputs (datasets) from spec.inputs[]
      for (const inp of (Array.isArray(spec.inputs) ? spec.inputs : []).slice(0, 20)) {
        const name = typeof inp === 'string' ? inp : (inp && (inp.name || inp.path)) || '';
        const did = await upsertNode('dataset', name, { source: 'spec.inputs' });
        await addEdge(resultId, did, 'uses');
      }
      // tool from command_hint (first meaningful token / clipped)
      if (spec.command_hint) {
        const tid = await upsertNode('tool', clip(spec.command_hint, 48), { source: 'spec.command_hint' });
        await addEdge(resultId, tid, 'uses');
      }
      // artifacts / figures produced
      for (const f of (Array.isArray(result.figures) ? result.figures : []).slice(0, 20)) {
        const aid = await upsertNode('artifact', (f && f.title) || 'figure', { source: 'result.figures', props: { has_image: !!(f && f.img) } });
        await addEdge(resultId, aid, 'produces');
      }
      for (const a of (Array.isArray(result.artifacts) ? result.artifacts : []).slice(0, 20)) {
        const name = typeof a === 'string' ? a : (a && (a.name || a.path)) || '';
        const aid = await upsertNode('artifact', name, { source: 'result.artifacts' });
        await addEdge(resultId, aid, 'produces');
      }

      // ---------- pass 2: Claude extraction (free text only) ----------
      const freetext = (summary + '\n\n' + report).trim();
      if (ANTHROPIC_KEY && resultId && freetext.length > 40) {
        try {
          const ex = await extract(step.title || '', freetext, Object.keys(metrics), (Array.isArray(spec.inputs) ? spec.inputs : []));
          for (const ent of ex.entities.slice(0, 40)) {
            const kind = NODE_KINDS.has(ent.type) ? ent.type : 'entity';
            const id = await upsertNode(kind, ent.name, { body: ent.description, source: 'llm' });
            // tie every extracted concept back to the result so the graph is connected
            const rel = (kind === 'dataset' || kind === 'method' || kind === 'tool') ? 'uses'
              : (kind === 'finding' || kind === 'artifact' || kind === 'metric') ? 'produces'
                : (kind === 'hypothesis') ? 'evaluates' : (kind === 'paper') ? 'cites' : 'related_to';
            await addEdge(resultId, id, rel);
          }
          for (const r of ex.relations.slice(0, 60)) {
            const sid = nodeCache[findKey(nodeCache, r.source)] || await upsertNode('entity', r.source, { source: 'llm' });
            const tid = nodeCache[findKey(nodeCache, r.target)] || await upsertNode('entity', r.target, { source: 'llm' });
            await addEdge(sid, tid, r.predicate, r.evidence);
          }
        } catch (_e) { nLlmFail++; }
      }

      // only mark ingested when the primary result node actually persisted — otherwise a transient DB
      // error would silently drop the step forever (the trigger only re-nulls on a result EDIT).
      if (resultId) {
        await svc.from('research_protocol_steps').update({ km_ingested_at: new Date().toISOString() }).eq('id', step.id);
        await svc.from('km_log').insert({ actor, op: 'ingest', node_id: resultId, project_id: projectId, note: 'step ' + step.ord + ' · ' + (proj.title || '') });
        nSteps++;
      } else {
        await svc.from('km_log').insert({ actor, op: 'ingest_failed', node_id: null, project_id: projectId, note: 'step ' + step.ord + ' — result node write failed; will retry' });
        nFailed++;
      }
    }

    return json({ ok: true, steps_processed: nSteps, nodes: nNodes, edges: nEdges, llm_failures: nLlmFail, failed: nFailed });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

// resolve a name to a cache key regardless of which kind it was stored under (first hit wins)
function findKey(cache: Record<string, string>, name: string): string {
  const nt = norm(name);
  for (const k of Object.keys(cache)) { if (k.endsWith('|' + nt)) return k; }
  return ' ';   // no match → cache[key] undefined → caller creates the node
}

// ---- Claude schema-constrained extraction → {entities, relations} ----
async function extract(title: string, text: string, metricNames: string[], inputs: any[]): Promise<{ entities: any[]; relations: any[] }> {
  const system = 'You extract a knowledge graph from a research task result. '
    + 'Return ONLY strict JSON, no prose, no code fence. Shape: '
    + '{"entities":[{"name":string,"type":one of ["method","dataset","finding","metric","hypothesis","paper","tool","entity"],"description":string}],'
    + '"relations":[{"source":string,"target":string,"predicate":one of ["uses","produces","measures","supports","contradicts","derived_from","evaluates","cites","related_to"],"evidence":string}]}. '
    + 'Rules: names are short canonical noun phrases (e.g. "BDD100K", "Mahalanobis distance", "AUROC"). '
    + 'A "finding" is a specific claim ("Fisher fusion raised per-class AUROC to 0.79"). '
    + 'Prefer few precise nodes over many vague ones. relations connect entity names you listed. '
    + 'Use "contradicts" when the result reverses/undercuts a prior claim. Max 25 entities, 40 relations.';
  const ctx = 'TASK: ' + clip(title, 200)
    + (metricNames.length ? '\nMETRICS: ' + metricNames.slice(0, 20).join(', ') : '')
    + (inputs.length ? '\nINPUTS: ' + inputs.map((i) => (typeof i === 'string' ? i : (i && (i.name || i.path)) || '')).filter(Boolean).slice(0, 20).join(', ') : '')
    + '\n\nRESULT TEXT:\n' + clip(text, 8000);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1800, system, messages: [{ role: 'user', content: ctx }] }),
  });
  const o = await r.json();
  if (o.error) throw new Error(o.error.message || 'anthropic');
  const raw = (o.content || []).map((b: any) => b.text || '').join('');
  const parsed = safeJson(raw);
  const entities = Array.isArray(parsed?.entities) ? parsed.entities.filter((e: any) => e && e.name) : [];
  const relations = Array.isArray(parsed?.relations) ? parsed.relations.filter((e: any) => e && e.source && e.target && e.predicate) : [];
  return { entities, relations };
}

function safeJson(s: string): any {
  if (!s) return null;
  let t = s.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(t); } catch (_e) { /* fall through */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_e) { /* ignore */ } }
  return null;
}
