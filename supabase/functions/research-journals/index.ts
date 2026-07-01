import { createClient } from 'jsr:@supabase/supabase-js@2';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = 'claude-sonnet-4-6';
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
async function callClaude(system: string, user: string, max = 4000): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: max, system, messages: [{ role: 'user', content: user }] }),
  });
  const o = await r.json(); if (o.error) throw new Error(o.error.message || 'anthropic');
  return (o.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
}
const SEL = 'id,title,field,discipline,npi_level,npi_level_year,sjr,sjr_quartile,h_index,country,open_access,publisher,url,issn_print,issn_online';

// Enrich candidates with real OpenAlex impact (h-index + 2-year mean citedness) on ISSN. Scimago's own SJR/quartile
// is Cloudflare-gated for automated download, so we use OpenAlex (reliable, free) as the impact layer.
async function enrichOpenAlex(cands: any[]) {
  const byIssn = new Map<string, any>();
  for (const c of cands) for (const s of [c.issn_print, c.issn_online]) if (s) byIssn.set(String(s).trim(), c);
  const issns = Array.from(byIssn.keys());
  for (let i = 0; i < issns.length; i += 50) {
    const flt = issns.slice(i, i + 50).join('|');
    try {
      const r = await fetch(`https://api.openalex.org/sources?per-page=200&mailto=publify@users.noreply&select=issn,summary_stats,works_count&filter=issn:${encodeURIComponent(flt)}`);
      const o = await r.json();
      for (const src of (o.results || [])) {
        const st = src.summary_stats || {};
        for (const is of (src.issn || [])) {
          const c = byIssn.get(String(is).trim());
          if (c && c._oa == null) { c.impact = st['2yr_mean_citedness'] != null ? Math.round(st['2yr_mean_citedness'] * 100) / 100 : null; if (st.h_index != null) c.h_index = st.h_index; c.oa_works = src.works_count; c._oa = 1; }
        }
      }
    } catch (_e) { /* skip batch */ }
  }
  for (const c of cands) delete c._oa;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: ures } = await sb.auth.getUser();
    if (!ures || !ures.user) return json({ error: 'unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'recommend');
    const projectId = String(body.project_id || '');
    if (!projectId) return json({ error: 'project_id required' }, 400);

    if (action === 'recommend') {
      const proj: any = (await sb.from('research_projects').select('*').eq('id', projectId).single()).data || {};
      const ideas: any[] = (await sb.from('research_ideas').select('question,hypothesis,status').eq('project_id', projectId).limit(8)).data || [];
      const prot: any = ((await sb.from('research_protocols').select('id,title,goal').eq('project_id', projectId).neq('status', 'archived').order('created_at', { ascending: false }).limit(1)).data || [])[0];
      let findings: string[] = [];
      if (prot) {
        const steps: any[] = (await sb.from('research_protocol_steps').select('title,result').eq('protocol_id', prot.id).order('ord')).data || [];
        findings = steps.map((s) => (s.result && s.result.summary) || s.title).filter(Boolean).slice(0, 8);
      }
      const hint = String(body.hint || '').slice(0, 600);
      const ctx = `PROJECT: ${proj.title || ''}\nTOPIC/DESCRIPTION: ${proj.topic || proj.description || proj.summary || ''}\n` +
        (proj.keywords ? `KEYWORDS: ${(Array.isArray(proj.keywords) ? proj.keywords.join(', ') : proj.keywords)}\n` : '') +
        `RESEARCH QUESTIONS:\n${ideas.map((i) => '- ' + String(i.question || '').slice(0, 300)).join('\n')}\n` +
        (prot ? `\nEXECUTED PROTOCOL: ${prot.title}\nGOAL: ${prot.goal || ''}\nFINDINGS/RESULTS:\n${findings.map((f) => '- ' + String(f).slice(0, 300)).join('\n')}\n` : '') +
        (hint ? `\nAUTHOR PREFERENCE: ${hint}\n` : '');

      const allFields: string[] = ((await sb.rpc('distinct_journal_fields')).data || []);
      const sys1 = 'You map a research project to the most relevant scientific PUBLICATION FIELDS. Choose ONLY from the provided list, copied EXACTLY (verbatim). Return ONLY JSON: {"fields":["<up to 3 exact field names from the list>"],"keywords":["<5-8 topical keywords>"],"summary":"<2-sentence research summary used to judge journal fit>"}.';
      const u1 = `${ctx}\n\nVALID FIELDS (choose exactly from these strings):\n${allFields.join('\n')}`;
      const r1 = await callClaude(sys1, u1, 1500);
      const m1 = r1.match(/\{[\s\S]*\}/); if (!m1) return json({ error: 'field-mapping returned no JSON' }, 502);
      const fm: any = JSON.parse(m1[0]);
      const fields: string[] = (fm.fields || []).filter((f: string) => allFields.includes(f));
      const kwList: string[] = (fm.keywords || []).map((w: string) => String(w));

      const byId = new Map<number, any>();
      if (fields.length) {
        const c1 = await sb.from('journals_ref').select(SEL).in('field', fields).gte('npi_level', 1).order('npi_level', { ascending: false }).limit(90);
        for (const j of (c1.data || [])) byId.set(j.id, j);
      }
      const tsq = kwList.map((w) => w.replace(/[^a-z0-9]/gi, '')).filter(Boolean).slice(0, 6).join(' | ');
      if (tsq) {
        const c2 = await sb.from('journals_ref').select(SEL).textSearch('search', tsq).gte('npi_level', 1).order('npi_level', { ascending: false }).limit(40);
        for (const j of (c2.data || [])) if (!byId.has(j.id)) byId.set(j.id, j);
      }
      const cand = Array.from(byId.values()).slice(0, 100);
      if (!cand.length) return json({ ok: true, fields, keywords: kwList, summary: fm.summary, journals: [], note: 'No matching journals in the register for these fields yet.' });
      await enrichOpenAlex(cand);

      const sys2 = 'You are a scholarly publishing advisor. Rank the candidate journals by suitability for publishing the described research. Weigh topical/scope fit highest, then prestige (Norwegian level 2 > level 1) and impact (higher 2-year mean citedness / h-index). Only recommend genuinely on-topic venues. Return ONLY JSON: {"ranked":[{"id":<journal id>,"fit_score":<integer 0-100>,"fit_reason":"<one concise sentence: why it fits this research>"}]} for the BEST 12, most suitable first.';
      const u2 = `RESEARCH: ${fm.summary}\nKEYWORDS: ${kwList.join(', ')}\n\nCANDIDATES (id | title | field | NorwegianLevel | impact(2yr citedness) | h-index | country | OA):\n` +
        cand.map((c) => `${c.id} | ${c.title} | ${c.field || ''} | L${c.npi_level} | ${c.impact != null ? c.impact : '-'} | ${c.h_index != null ? c.h_index : '-'} | ${c.country || ''} | ${c.open_access || ''}`).join('\n');
      const r2 = await callClaude(sys2, u2, 4000);
      const m2 = r2.match(/\{[\s\S]*\}/); if (!m2) return json({ error: 'ranking returned no JSON' }, 502);
      const ranked: any[] = (JSON.parse(m2[0]).ranked || []);
      const out = ranked.map((x) => { const j = byId.get(x.id); return j ? { ...j, fit_score: x.fit_score, fit_reason: x.fit_reason } : null; }).filter(Boolean).slice(0, 12);
      return json({ ok: true, fields, keywords: kwList, summary: fm.summary, journals: out, candidate_count: cand.length });
    }
    return json({ error: 'unknown action: ' + action }, 400);
  } catch (e) { return json({ error: String(e) }, 500); }
});
