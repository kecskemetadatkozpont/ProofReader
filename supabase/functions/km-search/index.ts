// Publify — Memory Layer search (km-search).
// Embeds the query with the built-in gte-small model, then calls km_hybrid_search (RRF of full-text
// + vector) UNDER THE CALLER'S JWT, so RLS composes and a user only ever fuses rows they may read.
// If embedding is unavailable it degrades to full-text only. No external embedding API.
//
// Deploy:  supabase functions deploy km-search
// Invoke:  POST { query: string, project_id?: uuid, kinds?: string[], limit?: number }  (with the user JWT)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertEntitled } from '../_shared/entitlement.ts';

// deno-lint-ignore no-explicit-any
declare const Supabase: any;   // Supabase Edge runtime gte-small inference

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const auth = req.headers.get('Authorization') || '';
    if (!auth) return json({ error: 'sign-in required' }, 401);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });

    const body = await req.json().catch(() => ({}));
    const query = String(body.query || '').trim();
    if (!query) return json({ error: 'query required' }, 400);
    const limit = Math.min(Math.max(parseInt(String(body.limit ?? 24), 10) || 24, 1), 60);
    const filterProject = body.project_id || null;
    const filterKinds = Array.isArray(body.kinds) && body.kinds.length ? body.kinds : null;

    const { data: ures } = await sb.auth.getUser();
    if (!ures?.user?.id) return json({ error: 'unauthenticated' }, 401);
    const gate = await assertEntitled(sb, 'page_memory'); if (gate) return gate;

    // embed the query with gte-small (compute only, no data → no RLS concern)
    let emb: string | null = null;
    try {
      const session = new Supabase.ai.Session('gte-small');
      const out = await session.run(query.slice(0, 2000), { mean_pool: true, normalize: true });
      const v = Array.isArray(out) ? out : (ArrayBuffer.isView(out) ? Array.from(out as any) : null);
      if (v && v.length === 384) emb = '[' + v.join(',') + ']';
    } catch (_e) { emb = null; }   // FTS-only fallback

    const { data, error } = await sb.rpc('km_hybrid_search', {
      query_text: query,
      query_embedding: emb,
      match_count: limit,
      filter_project: filterProject,
      filter_kinds: filterKinds,
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, semantic: !!emb, results: data || [] });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
