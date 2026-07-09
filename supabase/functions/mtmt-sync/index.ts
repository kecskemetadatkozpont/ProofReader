// Publify — MTMT publication sync. Pulls the signed-in user's publications from MTMT (m2.mtmt.hu) by their
// profiles.mtmt_id and upserts them into the publications table (researcher_id = the caller), under RLS.
// Runs server-side so MTMT's no-CORS API is reachable. Called via supabase.functions.invoke('mtmt-sync').
// Deploy:  supabase functions deploy mtmt-sync --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertEntitled } from '../_shared/entitlement.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const TYPE_HU: Record<string, string> = {
  JournalArticle: 'Folyóiratcikk', ConferencePaper: 'Konferenciaközlemény', Book: 'Könyv',
  BookChapter: 'Könyvrészlet', Chapter: 'Könyvrészlet', Thesis: 'Disszertáció', Patent: 'Szabadalom',
  Abstract: 'Absztrakt', Poster: 'Poszter', PublicationOther: 'Egyéb', Other: 'Egyéb',
};

function doiOf(p: any): string | null {
  for (const i of (p.identifiers || [])) {
    const nm = (i.source && (i.source.name || i.source.label)) || (i.source && i.source.type && i.source.type.label) || '';
    if (String(nm).toUpperCase() === 'DOI' && i.idValue) return String(i.idValue);
  }
  return null;
}

function mapPub(p: any, uid: string) {
  return {
    researcher_id: uid,
    mtid: p.mtid,
    type: p.otype || p.type || null,
    type_hu: TYPE_HU[p.otype] || null,
    title: p.title || null,
    year: Number.isFinite(p.publishedYear) ? p.publishedYear : null,
    first_author: p.firstAuthor || null,
    author_count: Number.isFinite(p.authorCount) ? p.authorCount : null,
    journal: (p.journal && p.journal.label) || null,
    volume: p.volume || null,
    issue: p.issue || null,
    pages: [p.firstPage, p.lastPage].filter(Boolean).join('-') || null,
    doi: doiOf(p),
    citations: Number.isFinite(p.citationCount) ? p.citationCount : 0,
    indep_citations: Number.isFinite(p.independentCitationCount) ? p.independentCitationCount : 0,
    oa_type: p.oaType || null,
    category: p.category || null,
    core: !!p.core,
    citation: p.label || null,
    mtmt_url: 'https://m2.mtmt.hu/api/publication/' + p.mtid,
  };
}

async function fetchMtmt(mtmtId: string): Promise<any[]> {
  const out: any[] = [];
  let page = 1, pages = 1; const size = 50;
  while (page <= pages && page <= 20) {
    const url = `https://m2.mtmt.hu/api/publication?cond=authorships.author.mtid;eq;${encodeURIComponent(mtmtId)}&size=${size}&page=${page}&format=json`;
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 20000);
    let doc: any;
    try { const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } }); doc = await r.json(); }
    finally { clearTimeout(to); }
    const content = (doc && doc.content) || [];
    for (const p of content) out.push(p);
    pages = (doc && doc.paging && doc.paging.totalPages) || 1;
    if (!content.length) break;
    page++;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: ures } = await sb.auth.getUser();
    const uid = ures?.user?.id;
    if (!uid) return json({ error: 'not signed in' }, 401);
    const gate = await assertEntitled(sb, 'mtmt_sync'); if (gate) return gate;
    const { data: prof } = await sb.from('profiles').select('mtmt_id').eq('id', uid).maybeSingle();
    const mtmtId = prof?.mtmt_id;
    if (!mtmtId) return json({ error: 'no_mtmt_id', message: 'Állítsd be az MTMT azonosítód a profilodban.' }, 400);
    const pubs = await fetchMtmt(String(mtmtId).trim());
    const rows = pubs.filter((p) => p && p.mtid).map((p) => mapPub(p, uid));
    if (rows.length) {
      const { error } = await sb.from('publications').upsert(rows, { onConflict: 'researcher_id,mtid' });
      if (error) return json({ error: error.message }, 403);
    }
    const { data: fresh } = await sb.from('publications').select('*').eq('researcher_id', uid).order('year', { ascending: false });
    return json({ ok: true, count: rows.length, publications: fresh || [] });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
