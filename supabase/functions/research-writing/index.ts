import { createClient } from 'jsr:@supabase/supabase-js@2';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const BEST = 'claude-opus-4-8';          // always use the best model for the manuscript
const FALLBACK = 'claude-sonnet-4-6';
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
async function callClaude(system: string, user: string, max = 4000, model = BEST): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: max, system, messages: [{ role: 'user', content: user }] }),
  });
  const o = await r.json();
  if (o.error) { if (model !== FALLBACK && /model|not_found|permission/i.test(o.error.message || '')) return callClaude(system, user, max, FALLBACK); throw new Error(o.error.message || 'anthropic'); }
  return (o.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
}
function bibKey(authors: any, year: any, used: Set<string>) {
  let a = 'ref'; if (Array.isArray(authors) && authors.length) a = String(authors[0]).split(/[\s,]+/)[0]; else if (typeof authors === 'string') a = authors.split(/[\s,]+/)[0];
  a = a.replace(/[^A-Za-z]/g, '').toLowerCase() || 'ref'; let k = a + (year || 'n'); let i = 1; while (used.has(k)) { k = a + (year || 'n') + String.fromCharCode(96 + i++); } used.add(k); return k;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: ures } = await sb.auth.getUser();
    if (!ures || !ures.user) return json({ error: 'unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const projectId = String(body.project_id || '');
    if (!projectId) return json({ error: 'project_id required' }, 400);

    // per-user daily AI budget (no-op until migration-48 is applied; then caps runaway spend)
    const DAILY_CAP = parseInt(Deno.env.get('AI_DAILY_CALLS') || '200', 10);
    const { data: over } = await sb.rpc('ai_over_budget', { max_calls: DAILY_CAP });
    if (over === true) return json({ error: 'Daily AI limit reached — please try again tomorrow.' }, 429);

    if (action === 'outline') {
      const proj: any = (await sb.from('research_projects').select('*').eq('id', projectId).single()).data || {};
      const ideas: any[] = (await sb.from('research_ideas').select('question,hypothesis,status').eq('project_id', projectId).limit(6)).data || [];
      const prot: any = ((await sb.from('research_protocols').select('id,title,goal').eq('project_id', projectId).neq('status', 'archived').order('created_at', { ascending: false }).limit(1)).data || [])[0];
      let resultsTxt = ''; let figures: any[] = [];
      if (prot) {
        const steps: any[] = (await sb.from('research_protocol_steps').select('ord,title,result,spec').eq('protocol_id', prot.id).order('ord')).data || [];
        resultsTxt = steps.map((s) => { const r = s.result || {}; const met = r.metrics ? '\n  metrics: ' + JSON.stringify(r.metrics).slice(0, 6000) : ''; return `[Step ${s.ord}] ${s.title}${r.summary ? '\n  ' + r.summary : ''}${met}`; }).join('\n');
        steps.forEach((s) => (s.result && s.result.figures || []).forEach((f: any, i: number) => figures.push({ key: `fig_${s.ord}_${i + 1}`, caption: f.title || ('Figure from step ' + s.ord) })));
        // dedup figures that repeat across steps (same caption) so each distinct figure is placed exactly once
        const seenCap = new Set<string>(); figures = figures.filter((f) => { const c = String(f.caption || '').trim().toLowerCase(); if (!c || seenCap.has(c)) return false; seenCap.add(c); return true; });
      }
      // literature to cite — from BOTH the library screening AND the Literature Study funnel includes
      const SSEL = 'id,title,authors,year,venue,doi,url,cited_by';
      const byId = new Map<any, any>();
      ((await sb.from('research_sources').select(SSEL).eq('project_id', projectId).eq('screening', 'include').limit(120)).data || []).forEach((s: any) => byId.set(s.id, s));
      const studies: any[] = (await sb.from('research_studies').select('id').eq('project_id', projectId)).data || [];
      if (studies.length) {
        const sp: any[] = (await sb.from('research_study_papers').select('source_id').in('study_id', studies.map((x) => x.id)).eq('decision', 'include').limit(500)).data || [];
        const need = Array.from(new Set(sp.map((x) => x.source_id).filter((id: any) => id != null && !byId.has(id))));
        if (need.length) ((await sb.from('research_sources').select(SSEL).in('id', need).limit(300)).data || []).forEach((s: any) => byId.set(s.id, s));
      }
      let srcs: any[] = Array.from(byId.values());
      if (!srcs.length) srcs = (await sb.from('research_sources').select(SSEL).eq('project_id', projectId).order('cited_by', { ascending: false, nullsFirst: false }).limit(40)).data || [];
      const used = new Set<string>(); const literature = srcs.map((s) => ({ key: bibKey(s.authors, s.year, used), title: s.title, authors: s.authors, year: s.year, venue: s.venue, doi: s.doi, url: s.url }));
      // journal
      let journal: any = { name: '', family: 'generic-latex', notes: '' };
      if (body.journal_pick_id) { const jp: any = (await sb.from('research_journal_picks').select('title,field,npi_level,details,template').eq('id', body.journal_pick_id).single()).data; if (jp) { const t = jp.template || {}; const d = jp.details || {}; journal = { name: jp.title, family: t.family || 'generic-latex', class_notes: t.notes || '', scope: d.scope || '', field: jp.field }; } }

      const research = `PROJECT: ${proj.title || ''}\nDESCRIPTION: ${proj.topic || proj.description || proj.summary || ''}\n` +
        `RESEARCH QUESTION: ${(ideas[0] && ideas[0].question) || ''}\nHYPOTHESIS: ${(ideas[0] && ideas[0].hypothesis) || ''}\n` +
        (prot ? `\nPROTOCOL: ${prot.title}\nGOAL: ${prot.goal || ''}\n\nRESULTS (verbatim from the executed protocol — the ONLY results you may report):\n${resultsTxt}\n` : '');

      const sys = 'You are a senior author planning a research manuscript for a specific journal. Design an outline grounded ONLY in the provided real results — never invent findings or numbers. Return ONLY JSON: {"title":"paper title","abstract":"150-220 word abstract using only the real results","keywords":["5-6"],"sections":[{"key":"introduction|related_work|method|results|discussion|conclusion|<slug>","heading":"Section heading","points":["3-6 bullet points to cover"],"cite_keys":["bib keys to cite here"],"figure_keys":["figure keys to place here"]}]}. Include the standard sections (Introduction, Related Work, Method, Results, Discussion, Conclusion) adapted to the journal. COMPLETENESS IS MANDATORY: every figure key in AVAILABLE FIGURES must appear in exactly ONE section\'s figure_keys — do not omit any figure. The Results section\'s points must cover EVERY quantitative result/metric in the RESULTS block (all detectors, all fusion variants, all numbers) — none may be left out.';
      const u = `${research}\n\nTARGET JOURNAL: ${journal.name || '(unspecified)'} — family ${journal.family}; scope: ${journal.scope || 'n/a'}\n\nAVAILABLE FIGURES: ${figures.map((f) => f.key + ' = ' + f.caption).join(' | ') || '(none)'}\n\nLITERATURE (cite by key):\n${literature.map((l) => `${l.key}: ${l.title} (${l.year || 'n.d.'})`).join('\n') || '(none)'}`;
      const raw = await callClaude(sys, u, 3000); sb.rpc('ai_usage_bump');
      const m = raw.match(/\{[\s\S]*\}/); if (!m) return json({ error: 'outline returned no JSON' }, 502);
      let ol: any; try { ol = JSON.parse(m[0]); } catch (e) { return json({ error: 'bad outline JSON: ' + e }, 502); }
      const context = { research, results: resultsTxt, literature, figures, journal, title: ol.title, abstract: ol.abstract, keywords: ol.keywords };
      return json({ ok: true, outline: ol, context, model: BEST });
    }

    if (action === 'section') {
      const ctx = body.context || {}; const sec = body.section || {};
      // bound the caller-supplied context so one request can't run up unlimited Opus token cost
      if (ctx.research) ctx.research = String(ctx.research).slice(0, 24000);
      if (Array.isArray(ctx.literature)) ctx.literature = ctx.literature.slice(0, 200);
      if (Array.isArray(ctx.figures)) ctx.figures = ctx.figures.slice(0, 60);
      const sys = 'You are writing ONE section of a research manuscript in LaTeX. Ground every claim ONLY in the provided research + results — NEVER invent numbers or findings; if something is unknown write "[TODO: ...]". Report ALL relevant numbers/metrics from the results that belong in this section — for a Results section, present EVERY detector/fusion metric (e.g. in a table); do not omit any. Cite with \\cite{key} using ONLY the given bib keys. You MUST place EVERY figure listed in ASSIGNED FIGURES — one \\begin{figure}[htbp] ... \\includegraphics[width=\\linewidth]{key.png} ... \\caption{...} \\label{fig:key} \\end{figure} per assigned key — and reference each with \\ref{fig:key}. Output ONLY the LaTeX body for this one section (start with \\section{...}); no preamble, no document wrapper, no code fences.';
      const u = `TARGET JOURNAL: ${(ctx.journal && ctx.journal.name) || 'generic'}\n\nRESEARCH & RESULTS (the only source of truth):\n${ctx.research || ''}\n\nAVAILABLE BIB KEYS: ${(ctx.literature || []).map((l: any) => l.key).join(', ') || '(none)'}\nASSIGNED FIGURES (place ALL of these): ${(sec.figure_keys || []).map((k: string) => { const f = (ctx.figures || []).find((x: any) => x.key === k); return k + (f ? ' ("' + f.caption + '")' : ''); }).join(' | ') || '(none)'}\n\nWRITE THIS SECTION:\nHeading: ${sec.heading}\nCover these points:\n- ${(sec.points || []).join('\n- ')}\nSuggested citations: ${(sec.cite_keys || []).join(', ')}`;
      const latex = await callClaude(sys, u, 3500); sb.rpc('ai_usage_bump');
      return json({ ok: true, key: sec.key, latex: latex.replace(/^```(latex)?/i, '').replace(/```$/, '').trim() });
    }

    return json({ error: 'unknown action: ' + action }, 400);
  } catch (e) { return json({ error: String(e) }, 500); }
});
