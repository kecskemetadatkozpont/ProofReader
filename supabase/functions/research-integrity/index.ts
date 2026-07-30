// Publify — Integrity Reviewer (Claude Science borrow). Compares the manuscript's claims/numbers
// against the project's REAL artifacts (research_files content, research_log RESULT entries,
// research_sources) and records what doesn't trace. AI-central HYBRID: a deterministic number-match
// pre-filter narrows the candidates + grounds the evidence; a Claude pass judges each (real problem
// vs legitimately-derived) and adds figure↔data / statistical / citation checks. Advises; never edits.
//
// Deploy:  supabase functions deploy research-integrity
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { assertEntitled, clampModel } from '../_shared/entitlement.ts';
import { langDirective, loadProjectLang } from '../_shared/lang.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = 'claude-sonnet-4-6';
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
async function callClaude(system: string, user: string, max: number, model: string): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: max, system, messages: [{ role: 'user', content: user }] }),
  });
  const o = await r.json(); if (o.error) throw new Error(o.error.message || 'anthropic');
  return (o.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
}

// deterministic: extract "result-like" numbers — decimals, percentages, p-values, NaN.
function extractNumbers(text: string): string[] {
  const out = new Set<string>();
  const re = /(?<![\w.\-])(\d+\.\d+\s*%?|\d{1,3}\s*%|p\s*[<=>]\s*0?\.\d+|\bNaN\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[1].replace(/\s+/g, '').toLowerCase());
  return Array.from(out);
}
const normNum = (s: string) => String(s).replace(/[%\s]/g, '').replace(',', '.').toLowerCase();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: ures } = await sb.auth.getUser();
    if (!ures || !ures.user) return json({ error: 'unauthorized' }, 401);
    const gate = await assertEntitled(sb, 'research_chat_ideas'); if (gate) return gate;   // also enforces the per-user daily AI budget (migration-48/101)
    const model = await clampModel(sb, MODEL);
    const body = await req.json().catch(() => ({}));
    const projectId = String(body.project_id || '');
    if (!projectId) return json({ error: 'project_id required' }, 400);
    const lang = await loadProjectLang(sb, projectId);

    // ---- manuscript: the newest draft's sections + writing/ files ----
    const draft: any = ((await sb.from('research_drafts').select('sections,title').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1)).data || [])[0];
    const sections: any[] = (draft && Array.isArray(draft.sections)) ? draft.sections : [];
    const files: any[] = (await sb.from('research_files').select('path,content').eq('project_id', projectId).not('content', 'is', null).limit(80)).data || [];
    const writingFiles = files.filter((f) => /^(writing|submission)\//i.test(f.path || ''));
    let manuscript = sections.map((s) => `## ${s.title || s.key || ''}\n${s.latex || s.content || ''}`).join('\n\n');
    if (writingFiles.length) manuscript += '\n\n' + writingFiles.map((f) => `## ${f.path}\n${String(f.content || '').slice(0, 4000)}`).join('\n\n');
    if (!manuscript.trim()) return json({ ok: true, findings: [], count: 0, note: 'no_manuscript' });

    // ---- artifacts: data files (csv/tsv/json/txt) + research_log results + library ----
    const dataFiles = files.filter((f) => /\.(csv|tsv|txt|json|dat|out)$/i.test(f.path || '') && !/^(writing|submission)\//i.test(f.path || ''));
    const artifactsText = dataFiles.map((f) => `### ${f.path}\n${String(f.content || '').slice(0, 4000)}`).join('\n\n');
    const logs: any[] = (await sb.from('research_log').select('type,summary,ts').eq('project_id', projectId).in('type', ['RESULT', 'MILESTONE', 'DECISION']).order('ts', { ascending: false }).limit(80)).data || [];
    const logText = logs.map((l) => `- [${l.type}] ${l.summary}`).join('\n');
    const sources: any[] = (await sb.from('research_sources').select('title,authors,year').eq('project_id', projectId).limit(150)).data || [];
    const sourcesText = sources.map((s) => `- ${(s.authors && s.authors[0]) || '?'} ${s.year || ''}: ${String(s.title || '').slice(0, 90)}`).join('\n');

    // ---- deterministic pre-filter: manuscript numbers with NO match in any artifact ----
    const artAll = artifactsText + '\n' + logText;
    const artSet = new Set(extractNumbers(artAll).map(normNum));
    const untraceable = extractNumbers(manuscript).filter((n) => {
      const nn = normNum(n); if (nn === 'nan') return false;   // NaN → the AI flags as a stat_flag, not "untraceable"
      const v = parseFloat(nn); if (isNaN(v)) return false;
      if (artSet.has(nn)) return false;
      for (const a of artSet) { const av = parseFloat(a); if (!isNaN(av) && Math.abs(av - v) <= Math.max(0.0005, Math.abs(v) * 0.005)) return false; }   // rounding-tolerant
      return true;
    }).slice(0, 40);

    const sys = "You are a rigorous research-integrity reviewer. Compare the MANUSCRIPT against the project's real ARTIFACTS (data files, result-log, library) and report ONLY genuine integrity problems. Check: (1) untraceable_number — a reported number that appears in NO artifact AND is not a legitimate derivation (mean/ratio/rounding of artifact values) — be conservative, do NOT flag a number you can plausibly derive; (2) figure_data — a figure/table CLAIM that contradicts its underlying data; (3) stat_flag — impossible/suspect stats (NaN, p>1, negative variance, inconsistent N); (4) citation — a citation not present in the library and not obviously real; (5) cross_inconsistency — the same metric reported with different values in different places. For each finding set ref_number to the exact number if numeric. NEVER invent corrections; ground every finding in a named artifact. Return ONLY JSON: {\"findings\":[{\"kind\":\"untraceable_number|figure_data|stat_flag|citation|cross_inconsistency\",\"severity\":\"high|medium|low\",\"claim\":\"<the flagged claim/number>\",\"location\":\"<section/where in the manuscript>\",\"evidence\":\"<what it was checked against + the artifact values>\",\"suggestion\":\"<what to verify/fix>\",\"ref_number\":\"<the number or empty>\"}]} — [] if nothing is wrong." + langDirective(lang);
    const user = `MANUSCRIPT:\n${manuscript.slice(0, 15000)}\n\nDATA ARTIFACTS (CSV / result-log — the ground truth for numbers):\n${artAll.slice(0, 11000) || '(none registered)'}\n\nLIBRARY (citable sources):\n${sourcesText.slice(0, 3000) || '(none)'}\n\nDETERMINISTIC PRE-FILTER — manuscript numbers with NO artifact match (candidates; JUDGE each, a legitimate derivation is NOT a finding):\n${untraceable.join(', ') || '(none)'}`;

    const raw = await callClaude(sys, user, 3500, model);
    const m = raw.match(/\{[\s\S]*\}/); if (!m) return json({ error: 'reviewer returned no JSON' }, 502);
    let parsed: any; try { parsed = JSON.parse(m[0]); } catch (_e) { return json({ error: 'reviewer JSON parse failed' }, 502); }
    const findings: any[] = Array.isArray(parsed.findings) ? parsed.findings.slice(0, 40) : [];

    // supersede: replace the previous OPEN findings (keep acknowledged/dismissed ones)
    const runId = crypto.randomUUID();
    await sb.from('research_integrity_findings').delete().eq('project_id', projectId).eq('status', 'open');
    if (findings.length) {
      const rows = findings.map((f) => ({
        project_id: projectId,
        kind: ['untraceable_number', 'figure_data', 'stat_flag', 'citation', 'cross_inconsistency'].includes(f.kind) ? f.kind : 'untraceable_number',
        severity: ['high', 'medium', 'low'].includes(f.severity) ? f.severity : 'medium',
        claim: String(f.claim || '').slice(0, 600), location: String(f.location || '').slice(0, 300),
        evidence: String(f.evidence || '').slice(0, 800), suggestion: String(f.suggestion || '').slice(0, 600),
        ref_number: f.ref_number ? String(f.ref_number).slice(0, 40) : null, run_id: runId, created_by: ures.user.id,
      }));
      await sb.from('research_integrity_findings').insert(rows);
    }
    return json({ ok: true, run_id: runId, count: findings.length, findings, checked: { sections: sections.length, dataFiles: dataFiles.length, logs: logs.length, sources: sources.length, untraceable_candidates: untraceable.length } });
  } catch (e) { return json({ error: String(e) }, 500); }
});
