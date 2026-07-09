import { createClient } from 'jsr:@supabase/supabase-js@2';
import { assertEntitled, resolveModel } from '../_shared/entitlement.ts';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = 'claude-sonnet-4-6';
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
async function claude(system: string, content: any[], max = 3000, model = MODEL): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: max, system, messages: [{ role: 'user', content }] }),
  });
  const o = await r.json(); if (o.error) throw new Error(o.error.message || 'anthropic');
  return (o.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
}
function jparse(raw: string) { const m = raw.match(/\{[\s\S]*\}/); if (!m) throw new Error('no JSON in model output'); return JSON.parse(m[0]); }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: ures } = await sb.auth.getUser();
    if (!ures || !ures.user) return json({ error: 'unauthorized' }, 401);
    const uid = ures.user.id;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const gate = await assertEntitled(sb, 'page_submissions'); if (gate) return gate;
    const model = await resolveModel(sb);
    const isEditor = async () => !!((await sb.from('editorial_staff').select('user_id').eq('user_id', uid).eq('active', true).maybeSingle()).data);

    // ---- extract: prefill wizard metadata from the uploaded PDF (author confirms every field) ----
    if (action === 'extract') {
      const b64 = String(body.pdf_base64 || '');
      if (!b64 || b64.length > 12_000_000) return json({ error: 'missing or too large PDF (max ~8 MB)' }, 400);
      const sys = 'Extract manuscript metadata from the FIRST pages of this scientific paper PDF. Return ONLY JSON: {"title":"...","abstract":"...","keywords":["..."],"authors":[{"name":"...","email":"","affiliation":""}]}. Copy the abstract verbatim. If a field is not present, use empty string/array — NEVER invent.';
      const raw = await claude(sys, [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
        { type: 'text', text: 'Extract the metadata as specified.' },
      ], 2500, model);
      return json({ ok: true, meta: jparse(raw) });
    }

    // ---- screen: advisory desk-check report for the editor (never decides) ----
    if (action === 'screen') {
      if (!(await isEditor())) return json({ error: 'editors only' }, 403);
      const sid = String(body.submission_id || '');
      const s: any = (await sb.from('submissions').select('*').eq('id', sid).single()).data;
      if (!s) return json({ error: 'submission not found' }, 404);
      const auth_ = (await sb.from('submission_authors').select('name,affiliation,orcid,is_corresponding').eq('submission_id', sid).order('position')).data || [];
      let venue = '';
      if (s.journal_ref_id) { const j: any = (await sb.from('journals_ref').select('title,field,discipline').eq('id', s.journal_ref_id).maybeSingle()).data; if (j) venue = `${j.title} (field: ${j.field})`; }
      const content: any[] = [];
      try {
        const v: any = ((await sb.from('submission_versions').select('storage_path,size').eq('submission_id', sid).eq('kind', 'manuscript').order('created_at', { ascending: false }).limit(1)).data || [])[0];
        if (v && v.storage_path && (!v.size || v.size < 8_000_000)) {
          const dl = await sb.storage.from('submission-files').download(v.storage_path);
          if (dl.data) {
            const buf = new Uint8Array(await dl.data.arrayBuffer());
            let bin = ''; const CH = 32768; for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH) as any);
            content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: btoa(bin) } });
          }
        }
      } catch (_e) { /* metadata-only fallback */ }
      const sys = 'You are an editorial-office assistant producing an ADVISORY desk-check (pre-review screening) report. You NEVER decide — the editor does. Assess honestly. Return ONLY JSON: {"summary":"3-4 sentence overall assessment","items":[{"check":"completeness|scope|format|declarations|language|overlap_suspicion","verdict":"ok|warn|fail","note":"one concise sentence"}]} with all six checks present.';
      content.push({ type: 'text', text: `SUBMISSION METADATA\nTitle: ${s.title}\nType: ${s.article_type}\nAbstract: ${s.abstract || '(none)'}\nKeywords: ${(s.keywords || []).join(', ')}\nAuthors: ${auth_.map((a: any) => a.name + (a.affiliation ? ' (' + a.affiliation + ')' : '')).join('; ')}\nTarget venue: ${venue || s.venue_text || '(unspecified)'}\nDeclarations: ${JSON.stringify(s.declarations)}\nCover letter: ${s.cover_letter || '(none)'}\n\nProduce the advisory report.${content.length ? ' The manuscript PDF is attached.' : ' (PDF not available — assess from metadata only.)'}` });
      const raw = await claude(sys, content, 2000, model);
      return json({ ok: true, report: jparse(raw) });
    }

    // ---- suggest_reviewers: rank existing researchers (editor-gated; service-role read of locked profiles) ----
    if (action === 'suggest_reviewers') {
      if (!(await isEditor())) return json({ error: 'editors only' }, 403);
      const sid = String(body.submission_id || '');
      const s: any = (await sb.from('submissions').select('id,title,abstract,keywords,owner_id').eq('id', sid).single()).data;
      if (!s) return json({ error: 'submission not found' }, 404);
      const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const authors = (await svc.from('submission_authors').select('name,email,user_id,affiliation').eq('submission_id', sid)).data || [];
      const profs = (await svc.from('profiles').select('id,name,email,research_interests,department,affiliation,is_researcher').eq('status', 'approved').limit(200)).data || [];
      const authorIds = new Set(authors.map((a: any) => a.user_id).filter(Boolean).concat([s.owner_id]));
      const authorEmails = new Set(authors.map((a: any) => (a.email || '').toLowerCase()).filter(Boolean));
      const pool = profs.filter((p: any) => !authorIds.has(p.id) && !authorEmails.has((p.email || '').toLowerCase()));
      const sys = 'Rank candidate reviewers for a manuscript by topical fit. COI signals you can see: same affiliation/department as any author → flag, do not exclude. Return ONLY JSON: {"suggestions":[{"id":"<profile id>","name":"...","score":<0-100>,"reason":"one sentence","coi_flag":"" or "same affiliation as author X"}]} — best 6, most suitable first. Only suggest people whose interests plausibly match; if fewer than 6 match, return fewer. Advisory only — COI detection is incomplete; the editor and the invited reviewer decide.';
      const u = `MANUSCRIPT\nTitle: ${s.title}\nAbstract: ${(s.abstract || '').slice(0, 1500)}\nKeywords: ${(s.keywords || []).join(', ')}\nAuthor affiliations: ${authors.map((a: any) => a.affiliation).filter(Boolean).join('; ') || '(unknown)'}\n\nCANDIDATES (id | name | interests | department | affiliation):\n${pool.map((p: any) => `${p.id} | ${p.name} | ${(p.research_interests || '').toString().slice(0, 120)} | ${p.department || ''} | ${p.affiliation || ''}`).join('\n')}`;
      const raw = await claude(sys, [{ type: 'text', text: u }], 2000, model);
      const out = jparse(raw);
      const valid = new Set(pool.map((p: any) => p.id));
      out.suggestions = (out.suggestions || []).filter((x: any) => valid.has(x.id));
      return json({ ok: true, suggestions: out.suggestions });
    }

    // ---- draft_letter: polish the current letter draft (editor edits + sends; draft only) ----
    if (action === 'draft_letter') {
      if (!(await isEditor())) return json({ error: 'editors only' }, 403);
      const sys = 'You improve an editorial letter draft: professional, warm but clear scholarly tone, keep ALL factual content (manuscript id, decision, deadlines, embedded review comments VERBATIM — never alter or summarize reviewer text), fix flow and formatting. Keep the same language as the draft. Return ONLY JSON: {"subject":"...","body":"..."}.';
      const u = `SUBJECT: ${String(body.subject || '')}\n\nDRAFT BODY:\n${String(body.body_text || '').slice(0, 12000)}`;
      const raw = await claude(sys, [{ type: 'text', text: u }], 3000, model);
      return json({ ok: true, letter: jparse(raw) });
    }

    return json({ error: 'unknown action: ' + action }, 400);
  } catch (e) { return json({ error: String(e) }, 500); }
});
