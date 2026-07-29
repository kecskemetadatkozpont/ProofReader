import { createClient } from 'jsr:@supabase/supabase-js@2';
import { assertEntitled, clampModel } from '../_shared/entitlement.ts';
import { langDirective, loadProjectLang } from '../_shared/lang.ts';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const OA_KEY = Deno.env.get('OPENALEX_API_KEY') || '';
const oaKey = OA_KEY ? '&api_key=' + OA_KEY : '';
const MODEL = 'claude-sonnet-4-6';
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
async function callClaude(system: string, user: string, max = 4000, model = MODEL): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: max, system, messages: [{ role: 'user', content: user }] }),
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
      const r = await fetch(`https://api.openalex.org/sources?per-page=200&mailto=publify@users.noreply&select=issn,summary_stats,works_count&filter=issn:${encodeURIComponent(flt)}${oaKey}`);
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
    const gate = await assertEntitled(sb, 'journal_matching'); if (gate) return gate;
    const model = await clampModel(sb, 'claude-sonnet-4-6');
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
      const r1 = await callClaude(sys1, u1, 1500, model);
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
      const r2 = await callClaude(sys2, u2, 4000, model);
      const m2 = r2.match(/\{[\s\S]*\}/); if (!m2) return json({ error: 'ranking returned no JSON' }, 502);
      const ranked: any[] = (JSON.parse(m2[0]).ranked || []);
      const out = ranked.map((x) => { const j = byId.get(x.id); return j ? { ...j, fit_score: x.fit_score, fit_reason: x.fit_reason } : null; }).filter(Boolean).slice(0, 12);
      return json({ ok: true, fields, keywords: kwList, summary: fm.summary, journals: out, candidate_count: cand.length });
    }
    if (action === 'dossier') {
      const jid = body.journal_id;
      // sanitise the interpolated ISSN to valid ISSN chars only — prevents PostgREST .or() filter injection
      const issn = String(body.issn || '').replace(/[^0-9Xx-]/g, '').slice(0, 12);
      const q = jid != null ? sb.from('journals_ref').select('*').eq('id', jid) : sb.from('journals_ref').select('*').or(`issn_print.eq.${issn},issn_online.eq.${issn}`);
      const jr: any = ((await q.limit(1)).data || [])[0];
      if (!jr) return json({ error: 'journal not found' }, 404);
      // OpenAlex hard metrics (by ISSN)
      let oa: any = {};
      const issns = [jr.issn_online, jr.issn_print].filter(Boolean).map((s: string) => String(s).trim());
      if (issns.length) {
        try {
          const r = await fetch(`https://api.openalex.org/sources?per-page=1&mailto=publify@users.noreply&select=display_name,issn,homepage_url,works_count,is_oa,is_in_doaj,apc_usd,apc_prices,country_code,host_organization_name,summary_stats,topics&filter=issn:${encodeURIComponent(issns.join('|'))}${oaKey}`);
          const o = await r.json(); const s = (o.results || [])[0];
          if (s) {
            const st = s.summary_stats || {};
            oa = { homepage_url: s.homepage_url, works_count: s.works_count, is_oa: s.is_oa, is_in_doaj: s.is_in_doaj, apc_usd: s.apc_usd, publisher: s.host_organization_name, country_code: s.country_code,
              h_index: st.h_index, impact_2yr: st['2yr_mean_citedness'] != null ? Math.round(st['2yr_mean_citedness'] * 100) / 100 : null, i10: st.i10_index,
              topics: (s.topics || []).slice(0, 6).map((t: any) => t.display_name) };
          }
        } catch (_e) { /* openalex optional */ }
      }
      // Claude: scope + template family + soft KPIs (labelled estimated) + submission URL
      const sys = 'You are a scholarly-publishing librarian. For the given journal, provide its aims/scope and the details that are NOT in bibliometric APIs, using your knowledge. Mark every figure as an estimate. Return ONLY JSON: {"scope":"2-3 sentence aims & scope","peer_review":"e.g. single-blind / double-blind (estimated)","acceptance_rate":"e.g. ~20% (estimated) or unknown","first_decision":"e.g. ~8 weeks (estimated) or unknown","apc":"e.g. $2500 APC / hybrid / free (estimated) or unknown","submission_url":"best-known author-guidelines or submission URL (or empty)","template":{"family":"one of IEEEtran|elsarticle|sn-jnl (Springer Nature)|mdpi|acmart|wiley-njd|tf (Taylor & Francis)|generic-latex|word","official_url":"official author-template page URL (or empty)","overleaf_url":"Overleaf template gallery URL for this family (or empty)","notes":"1 line on format (columns, length, refs style)"}}';
      const u = `JOURNAL: ${jr.title}\nPUBLISHER: ${oa.publisher || jr.publisher || ''}\nFIELD: ${jr.field || ''}\nCOUNTRY: ${jr.country || ''}\nISSN: ${issns.join(', ')}\nHOMEPAGE: ${oa.homepage_url || jr.url || ''}\nOPENALEX TOPICS: ${(oa.topics || []).join(', ')}`;
      let ai: any = {};
      try { const raw = await callClaude(sys, u, 1500, model); const m = raw.match(/\{[\s\S]*\}/); if (m) ai = JSON.parse(m[0]); } catch (_e) { /* ai optional */ }
      return json({ ok: true, journal: jr, openalex: oa, ai });
    }

    // JF3 — Beadási stratégia: given the author's project + the journal's RECENT papers (fetched client-side in JF2),
    // produce a tailored submission playbook (fit score, verdict, playbook, gaps). Grounded in the supplied papers.
    if (action === 'fit') {
      const jid = body.journal_id;
      const issn = String(body.issn || '').replace(/[^0-9Xx-]/g, '').slice(0, 12);
      const jsel = 'title,publisher,field,discipline,country,issn_print,issn_online,sjr_quartile,npi_level';
      const jq = jid != null ? sb.from('journals_ref').select(jsel).eq('id', jid)
        : (issn ? sb.from('journals_ref').select(jsel).or(`issn_print.eq.${issn},issn_online.eq.${issn}`) : null);
      const jr: any = (jq ? ((await jq.limit(1)).data || [])[0] : null) || { title: String(body.journal_title || 'the target journal') };
      const papers: any[] = Array.isArray(body.papers) ? body.papers.slice(0, 16) : [];
      const themes: string[] = Array.isArray(body.themes) ? body.themes.slice(0, 12).map((t: any) => String(t)) : [];
      if (!papers.length) return json({ error: 'no recent papers supplied — run the facts-only analysis first' }, 400);

      const proj: any = (await sb.from('research_projects').select('*').eq('id', projectId).single()).data || {};
      const ideas: any[] = (await sb.from('research_ideas').select('question,hypothesis').eq('project_id', projectId).limit(8)).data || [];
      const prot: any = ((await sb.from('research_protocols').select('id,title,goal').eq('project_id', projectId).neq('status', 'archived').order('created_at', { ascending: false }).limit(1)).data || [])[0];
      let findings: string[] = [];
      if (prot) {
        const steps: any[] = (await sb.from('research_protocol_steps').select('title,result').eq('protocol_id', prot.id).order('ord')).data || [];
        findings = steps.map((s) => (s.result && s.result.summary) || s.title).filter(Boolean).slice(0, 8);
      }
      const lang = await loadProjectLang(sb, projectId);
      const ctx = `PROJECT (the author's paper): ${proj.title || ''}\nTOPIC: ${proj.topic || proj.description || proj.summary || ''}\n` +
        (proj.keywords ? `KEYWORDS: ${(Array.isArray(proj.keywords) ? proj.keywords.join(', ') : proj.keywords)}\n` : '') +
        `RESEARCH QUESTIONS:\n${ideas.map((i) => '- ' + String(i.question || '').slice(0, 240)).join('\n')}\n` +
        (prot ? `EXECUTED WORK: ${prot.title} — ${prot.goal || ''}\nKEY RESULTS:\n${findings.map((f) => '- ' + String(f).slice(0, 240)).join('\n')}\n` : '');
      const recent = papers.map((p, i) => `${i + 1}. (${p.year || '—'}) ${String(p.title || '').slice(0, 160)}` +
        (p.abstract ? `\n   ${String(p.abstract).slice(0, 300)}` : '') +
        (Array.isArray(p.concepts) && p.concepts.length ? `\n   [${p.concepts.slice(0, 4).join(', ')}]` : '')).join('\n');

      const sys = "You are a scholarly-publishing strategist. Given an author's research project and a TARGET JOURNAL's recent publications, produce a concrete, tailored submission strategy for THIS paper: how well it fits, what the journal publishes lately, and exactly how to position the paper. Ground every claim in the supplied recent papers + project context; do NOT invent journal policies, acceptance rates or metrics. Return ONLY JSON: {\"fit_score\":<integer 0-100>,\"verdict\":\"<2-3 sentences: fit strengths + the main caveat>\",\"themes_observed\":[\"<recurring topic/method/framing the journal favours, drawn from the abstracts>\"],\"playbook\":{\"title_framing\":\"<how to frame this paper's title for this venue>\",\"keywords\":[\"<6 submission keywords>\"],\"emphasize\":[\"<which of the author's results/contributions to foreground, and why>\"],\"structure_length\":\"<expected structure + rough length if inferable, else empty>\",\"cover_letter\":\"<1-2 sentence cover-letter angle>\",\"formatting\":[\"<short checklist item>\"]},\"gaps\":[{\"your_side\":\"<a trait of the author's work>\",\"journal_side\":\"<the journal's recent expectation>\",\"bridge\":\"<one concrete adjustment>\"}]}" + langDirective(lang);
      const u = `${ctx}\nTARGET JOURNAL: ${jr.title}${jr.publisher ? ' (' + jr.publisher + ')' : ''}${jr.sjr_quartile ? ' · ' + jr.sjr_quartile : ''}\nRECURRING THEMES (from recent works): ${themes.join(', ')}\n\nTHE JOURNAL'S RECENT PUBLICATIONS:\n${recent}`;
      const raw = await callClaude(sys, u, 3200, model);
      const m = raw.match(/\{[\s\S]*\}/); if (!m) return json({ error: 'fit report returned no JSON' }, 502);
      let report: any; try { report = JSON.parse(m[0]); } catch (_e) { return json({ error: 'fit report JSON parse failed' }, 502); }
      return json({ ok: true, report });
    }

    return json({ error: 'unknown action: ' + action }, 400);
  } catch (e) { return json({ error: String(e) }, 500); }
});
