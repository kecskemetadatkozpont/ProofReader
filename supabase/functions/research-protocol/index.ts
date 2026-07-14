import { createClient } from 'jsr:@supabase/supabase-js@2';
import { assertEntitled, clampModel } from '../_shared/entitlement.ts';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = 'claude-sonnet-4-6';   // planning quality matters for the protocol
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

const SYS = `You are a senior research engineer planning an EXECUTABLE research protocol that a Claude Code agent will run autonomously on a dedicated GPU machine. Turn the idea + selected literature into an ORDERED list of concrete, atomic, verifiable steps (data → preprocess → baselines → method → evaluation → figures → write-up). Each step must be runnable and checkable on its own.

Return ONLY a JSON object, no prose, no markdown fences:
{"title": "<short protocol title>", "steps": [
  {"title": "<imperative, specific>",
   "kind": "data|preprocess|train|eval|analysis|figure|writeup|custom",
   "instruction": "<exactly what to do, concrete enough for an agent to execute>",
   "inputs": ["<files/datasets/prev-step outputs>"],
   "expected_outputs": ["<files/metrics/artifacts produced>"],
   "acceptance": ["<objective checks that prove the step succeeded>"],
   "command_hint": "<a likely shell command or script, or empty>",
   "est_minutes": <integer>,
   "depends_on": [<1-based step numbers that must finish first>],
   "needs_approval": <true if it trains on GPU for long, downloads/deletes/overwrites large data, spends money, or calls an external paid service; else false>}
]}
Keep it 6–12 steps. Be specific but CONCISE (instruction ≤ 2 sentences; ≤ 4 items per array). Set needs_approval conservatively (prefer true for anything expensive or destructive). Output must be a single, complete, valid JSON object.`;

async function callClaude(system: string, user: string, model: string): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 8000, system, messages: [{ role: 'user', content: user }] }),
  });
  const o = await r.json(); if (o.error) throw new Error(o.error.message || 'anthropic');
  return (o.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: ures } = await sb.auth.getUser();
    if (!ures || !ures.user) return json({ error: 'unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const gate = await assertEntitled(sb, 'protocol_runner'); if (gate) return gate;
    const model = await clampModel(sb, 'claude-sonnet-4-6');
    const action = String(body.action || 'generate');
    const projectId = String(body.project_id || '');
    if (!projectId) return json({ error: 'project_id required' }, 400);

    if (action === 'generate') {
      const goal = String(body.goal || '').slice(0, 2000);
      const ideaId = body.idea_id || null;
      // gather context (RLS scopes everything to the caller's project access)
      const ideasQ = await sb.from('research_ideas').select('id,question,hypothesis,status').eq('project_id', projectId).order('created_at', { ascending: true }).limit(24);
      const ideas = (ideasQ.data || []);
      let idea: any = ideaId ? ideas.find((x: any) => x.id === ideaId) : (ideas.find((x: any) => x.status === 'selected') || ideas[0]);
      // a caller-supplied lineage idea_id (Map "generate from this node") may point OUTSIDE the loaded window →
      // fetch it directly so the protocol's provenance link (idea_id) is never silently severed. Fall back only if truly absent.
      if (ideaId && !idea) { const iq = await sb.from('research_ideas').select('id,question,hypothesis,status').eq('project_id', projectId).eq('id', ideaId).maybeSingle(); idea = (iq.data as any) || null; }
      if (!idea) idea = ideas.find((x: any) => x.status === 'selected') || ideas[0];
      const srcQ = await sb.from('research_sources').select('title,venue,year,screening').eq('project_id', projectId).limit(200);
      const allSrc = (srcQ.data || []);
      const inc = allSrc.filter((s: any) => s.screening === 'include');
      const lit = (inc.length ? inc : allSrc).slice(0, 25);
      const dsQ = await sb.from('research_datasets').select('name,notes').eq('project_id', projectId).limit(20);
      const datasets = (dsQ.data || []);

      const litTxt = lit.map((s: any, i: number) => `${i + 1}. ${s.title}${s.venue ? ' — ' + s.venue : ''}${s.year ? ' (' + s.year + ')' : ''}`).join('\n') || '(none yet)';
      const dsTxt = datasets.map((d: any) => `- ${d.name}${d.notes ? ': ' + d.notes : ''}`).join('\n') || '(none registered)';
      const user = `RESEARCH IDEA:\n${idea ? (idea.question || '') + (idea.hypothesis ? '\nHypothesis: ' + idea.hypothesis : '') : '(no idea recorded)'}\n\n`
        + (goal ? `GOAL FOR THIS PROTOCOL:\n${goal}\n\n` : '')
        + `SELECTED LITERATURE (${lit.length}):\n${litTxt}\n\n`
        + `DATASETS ALREADY REGISTERED:\n${dsTxt}\n\n`
        + `Plan the executable protocol now.`;

      const raw = await callClaude(SYS, user, model);
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return json({ error: 'model did not return JSON' }, 502);
      let parsed: any; try { parsed = JSON.parse(m[0]); } catch (e) { return json({ error: 'bad JSON from model: ' + e }, 502); }
      const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
      if (!steps.length) return json({ error: 'no steps generated' }, 502);

      // one active protocol per project — archive any current non-terminal one first (unique index rprot_one_active)
      await sb.from('research_protocols').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('project_id', projectId).in('status', ['draft', 'ready', 'running', 'paused', 'failed']);
      const snapshot = { idea: idea ? { id: idea.id, question: idea.question } : null, included_sources: lit.map((s: any) => s.title), datasets: datasets.map((d: any) => d.name), generated_at: new Date().toISOString() };
      const protIns = await sb.from('research_protocols').insert({ project_id: projectId, idea_id: idea ? idea.id : null, title: String(parsed.title || 'Research protocol').slice(0, 200), goal: goal || null, status: 'draft', context_snapshot: snapshot, created_by: ures.user.id }).select('id').single();
      if (protIns.error || !protIns.data) return json({ error: 'insert protocol failed: ' + (protIns.error && protIns.error.message) }, 500);
      const pid = protIns.data.id;
      const rows = steps.slice(0, 20).map((s: any, i: number) => ({
        protocol_id: pid, ord: i + 1, title: String(s.title || ('Step ' + (i + 1))).slice(0, 240), kind: String(s.kind || 'custom'),
        spec: { instruction: s.instruction || '', inputs: s.inputs || [], expected_outputs: s.expected_outputs || [], acceptance: s.acceptance || [], command_hint: s.command_hint || '', est_minutes: Number.isFinite(s.est_minutes) ? s.est_minutes : null },
        depends_on: (Array.isArray(s.depends_on) ? s.depends_on : []).filter((n: any) => Number.isInteger(n) && n >= 1 && n <= steps.length),
        needs_approval: !!s.needs_approval,
      }));
      const stepIns = await sb.from('research_protocol_steps').insert(rows);
      if (stepIns.error) return json({ error: 'insert steps failed: ' + stepIns.error.message }, 500);
      return json({ ok: true, protocol_id: pid, steps: rows.length });
    }

    // ---- Task Editor AI-assist: these RETURN data (no DB writes); the client applies them via RLS ----
    if (action === 'refine_step') {
      const stepId = String(body.step_id || ''); const hint = String(body.hint || '').slice(0, 1500);
      if (!stepId) return json({ error: 'step_id required' }, 400);
      const stq = await sb.from('research_protocol_steps').select('*').eq('id', stepId).single();
      if (stq.error || !stq.data) return json({ error: 'step not found' }, 404);
      const s = stq.data; const sx = s.spec || {};
      const pq = await sb.from('research_protocols').select('goal,context_snapshot').eq('id', s.protocol_id).single();
      const ctx = (pq.data && pq.data.context_snapshot) || {};
      const sys = 'You are improving ONE step of an executable research protocol. Keep its intent; make it more precise and runnable. Return ONLY a JSON object: {"title","kind","instruction","inputs":[],"expected_outputs":[],"acceptance":[],"command_hint":"","est_minutes":N,"needs_approval":bool}. Be concise.';
      const u = `PROTOCOL GOAL: ${(pq.data && pq.data.goal) || ''}\nIDEA: ${(ctx.idea && ctx.idea.question) || ''}\n\nCURRENT STEP:\n${JSON.stringify({ title: s.title, kind: s.kind, ...sx }, null, 1)}\n\n${hint ? 'FOCUS: ' + hint + '\n\n' : ''}Return the improved step.`;
      const raw = await callClaude(sys, u, model); const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return json({ error: 'model returned no JSON' }, 502);
      let p: any; try { p = JSON.parse(m[0]); } catch (e) { return json({ error: 'bad JSON: ' + e }, 502); }
      return json({ ok: true, step: p });
    }

    if (action === 'append_steps') {
      const pid = String(body.protocol_id || ''); const prompt = String(body.prompt || '').slice(0, 1500);
      const files = Array.isArray(body.files) ? body.files.slice(0, 20) : [];
      const count = Math.min(6, Math.max(1, parseInt(body.count, 10) || (files.length ? 5 : 3)));
      if (!pid || (!prompt && !files.length)) return json({ error: 'protocol_id + prompt or files required' }, 400);
      const pq = await sb.from('research_protocols').select('goal,context_snapshot').eq('id', pid).single();
      const exq = await sb.from('research_protocol_steps').select('ord,title,kind').eq('protocol_id', pid).order('ord');
      const ex = (exq.data || []); const ctx = (pq.data && pq.data.context_snapshot) || {};
      const filesTxt = files.length ? `\n\nThe researcher provided these data sources for these tasks. Generate a small pipeline that LOADS and PROCESSES this specific data — a "data" step first (uploaded files are attached to it; for a URL, the data step must DOWNLOAD/stream it from that URL), then the preprocessing/analysis/eval steps that consume it. Reference the names/URLs in the instructions.\n${files.map((f: any) => f.url ? `- ${String(f.name || 'dataset')} — available at URL: ${String(f.url).slice(0, 400)} (download/stream it in the data step)${f.note ? ' — ' + String(f.note).slice(0, 200) : ''}` : `- ${String(f.name || 'file')} (uploaded${f.mime ? ', ' + f.mime : ''}${f.size ? ', ' + Math.round(f.size / 1024) + ' KB' : ''})${f.note ? ' — ' + String(f.note).slice(0, 200) : ''}`).join('\n')}` : '';
      const sys = `Propose NEW steps to add to an existing executable research protocol. Return ONLY a JSON object {"steps":[{"title","kind","instruction","inputs":[],"expected_outputs":[],"acceptance":[],"command_hint":"","est_minutes":N,"depends_on":[],"needs_approval":bool}]}. Use depends_on with the 1-based positions of EXISTING steps if relevant. At most ${count} steps, concise. When data files are provided, the FIRST step must be kind:"data" (data ingestion/validation of those files).`;
      const u = `PROTOCOL GOAL: ${(pq.data && pq.data.goal) || ''}\nIDEA: ${(ctx.idea && ctx.idea.question) || ''}\n\nEXISTING STEPS:\n${ex.map((e: any) => `${e.ord}. [${e.kind}] ${e.title}`).join('\n') || '(none)'}\n\nADD STEPS FOR: ${prompt || '(process the uploaded data below)'}${filesTxt}`;
      const raw = await callClaude(sys, u, model); const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return json({ error: 'model returned no JSON' }, 502);
      let p: any; try { p = JSON.parse(m[0]); } catch (e) { return json({ error: 'bad JSON: ' + e }, 502); }
      return json({ ok: true, steps: (Array.isArray(p.steps) ? p.steps : []).slice(0, count) });
    }

    if (action === 'split_step') {
      const stepId = String(body.step_id || '');
      if (!stepId) return json({ error: 'step_id required' }, 400);
      const stq = await sb.from('research_protocol_steps').select('*').eq('id', stepId).single();
      if (stq.error || !stq.data) return json({ error: 'step not found' }, 404);
      const s = stq.data; const sx = s.spec || {};
      const sys = 'Split ONE protocol step into 2–4 smaller, ordered sub-steps that together accomplish it. Return ONLY {"steps":[{"title","kind","instruction","inputs":[],"expected_outputs":[],"acceptance":[],"command_hint":"","est_minutes":N,"needs_approval":bool}]}. Concise; each sub-step runnable on its own.';
      const u = `STEP TO SPLIT:\n${JSON.stringify({ title: s.title, kind: s.kind, ...sx }, null, 1)}`;
      const raw = await callClaude(sys, u, model); const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return json({ error: 'model returned no JSON' }, 502);
      let p: any; try { p = JSON.parse(m[0]); } catch (e) { return json({ error: 'bad JSON: ' + e }, 502); }
      return json({ ok: true, steps: (Array.isArray(p.steps) ? p.steps : []).slice(0, 4) });
    }

    // ---- task_assist: conversational helper for ONE task draft in the editor (discuss, ask clarifying
    //      questions about uploaded data, and propose concrete field values) ----
    if (action === 'task_assist') {
      const task = (body.task && typeof body.task === 'object') ? body.task : {};
      const msg = String(body.message || '').slice(0, 4000);
      const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
      const files = Array.isArray(body.files) ? body.files.slice(0, 20) : [];
      const arr = (v: any) => Array.isArray(v) ? v.filter(Boolean) : [];
      const filesTxt = files.map((f: any) => `- ${String(f.name || 'file')} (${f.mime || 'type?'}${f.size ? ', ' + Math.round(f.size / 1024) + ' KB' : ''})${f.note ? ' — note: ' + String(f.note).slice(0, 300) : ''}`).join('\n');
      const taskTxt = `Title: ${task.title || '(untitled)'}\nKind: ${task.kind || 'custom'}\nInstruction: ${task.instruction || '(empty)'}\nInputs: ${arr(task.inputs).join('; ') || '(none)'}\nExpected outputs: ${arr(task.expected_outputs).join('; ') || '(none)'}\nAcceptance: ${arr(task.acceptance).join('; ') || '(none)'}\nCommand hint: ${task.command_hint || '(none)'}`;
      const KINDS = 'data | preprocess | train | eval | analysis | figure | writeup | custom';
      const system = `You are Publify's task assistant. You help a researcher define ONE task in an executable research protocol (a Claude agent will later run it on a machine). Be concise, concrete and practical — talk like a helpful collaborator, not a form. When the task is underspecified — ESPECIALLY when files/data were just uploaded — ask 1–3 focused clarifying questions (for a dataset: the target/label, what the columns mean, the split, the metric, the format).
For EVERY clarifying question you MUST also offer 2–4 concrete suggested ANSWERS (short phrases the researcher can pick with one click, e.g. for a metric: ["Accuracy","F1","AUROC","RMSE"]). Make them realistic, best-guess options given the context.
As soon as the researcher's answers give you enough to sharpen the task, POPULATE "suggestion" with the concrete field values (only the fields you would actually change; kind must be one of: ${KINDS}) — do this proactively; the app auto-fills the form from it. Never invent file contents you were not told about.`;
      const user = `Current task draft:\n${taskTxt}\n\n${filesTxt ? `Files attached to this task:\n${filesTxt}\n\n` : ''}${history.length ? `Conversation so far:\n${history.map((m: any) => `${m.role === 'user' ? 'Researcher' : 'Assistant'}: ${String(m.content || '').slice(0, 1500)}`).join('\n')}\n\n` : ''}Researcher: ${msg || '(They just opened the assistant or attached a file and have not typed anything. Greet in one short sentence, then — if a file is attached or the task is vague — ask your clarifying questions with suggested-answer options.)'}\n\nReturn ONLY JSON: {"reply":"<your conversational reply>","questions":[{"q":"<clarifying question>","options":["<2-4 short suggested answers to pick from>"]}],"suggestion":{<the task fields to fill: "title"?, "kind"?, "instruction"?, "inputs"?:[], "expected_outputs"?:[], "acceptance"?:[], "command_hint"? — or {} if not enough info yet>}}`;
      let out = '';
      try { out = await callClaude(system, user, model); } catch (_e) { return json({ error: 'AI is unavailable — try again.' }, 502); }
      const mm = out.match(/\{[\s\S]*\}/); let p: any = {};
      if (mm) { try { p = JSON.parse(mm[0]); } catch { p = {}; } }
      const sug = (p.suggestion && typeof p.suggestion === 'object' && Object.keys(p.suggestion).length) ? p.suggestion : null;
      const normQ = (x: any) => {
        if (typeof x === 'string') return x.trim() ? { q: x.slice(0, 300), options: [] } : null;
        if (x && typeof x === 'object' && (x.q || x.question)) return { q: String(x.q || x.question).slice(0, 300), options: Array.isArray(x.options) ? x.options.map((o: any) => String(o || '').slice(0, 120)).filter(Boolean).slice(0, 4) : [] };
        return null;
      };
      const questions = Array.isArray(p.questions) ? p.questions.map(normQ).filter(Boolean).slice(0, 3) : [];
      return json({ ok: true, reply: String(p.reply || out || '').slice(0, 4000), questions, suggestion: sug });
    }

    // ---- protocol_chat: talk to the whole protocol — the AI sees every task's status/result/notes ----
    if (action === 'protocol_chat') {
      const protocol_id = String(body.protocol_id || '');
      if (!protocol_id) return json({ error: 'protocol_id required' }, 400);
      const msg = String(body.message || '').slice(0, 4000);
      const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
      const pq = await sb.from('research_protocols').select('title,goal').eq('id', protocol_id).single();
      const sq = await sb.from('research_protocol_steps').select('id,ord,title,kind,status,spec,result,needs_approval,depends_on').eq('protocol_id', protocol_id).order('ord');
      const nq = await sb.from('research_protocol_notes').select('step_id,kind,body,author_name').eq('protocol_id', protocol_id).order('created_at');
      const steps = (sq.data || []); const notes = (nq.data || []);
      const noteByStep: Record<string, any[]> = {}; notes.forEach((n: any) => { (noteByStep[n.step_id] = noteByStep[n.step_id] || []).push(n); });
      const snap = steps.map((s: any) => {
        const sx = s.spec || {}, r = s.result || {};
        const ns = (noteByStep[s.id] || []).map((n: any) => `\n   • ${n.author_name || 'member'} (${n.kind}): ${String(n.body || '').slice(0, 200)}`).join('');
        return `Task ${s.ord} [${s.kind}] "${s.title}" — status: ${s.status}${s.needs_approval ? ' (needs approval)' : ''}${(s.depends_on && s.depends_on.length) ? ' (after ' + s.depends_on.join(',') + ')' : ''}${sx.instruction ? '\n   instruction: ' + String(sx.instruction).slice(0, 300) : ''}${r.summary ? '\n   result: ' + String(r.summary).slice(0, 300) : ''}${r.error ? '\n   ERROR: ' + String(r.error).slice(0, 200) : ''}${r.adaptation ? '\n   adaptation: ' + String(r.adaptation).slice(0, 150) : ''}${ns}`;
      }).join('\n');
      const system = `You are Publify's Protocol assistant. You can see the ENTIRE executable research protocol — every task with its kind, status, instruction, result, error, and notes. Answer the researcher's question about ANY or ALL of the tasks: current status, what the runner did and why, why a task failed, what is waiting for approval, and what to do next. Be concise and specific; reference tasks by their number (e.g. "Task 3"). Never invent results you cannot see in the snapshot.`;
      const user = `PROTOCOL: ${(pq.data && pq.data.title) || ''}${(pq.data && pq.data.goal) ? '\nGOAL: ' + pq.data.goal : ''}\n\nALL TASKS (${steps.length}):\n${snap || '(no tasks yet)'}\n\n${history.length ? 'Conversation so far:\n' + history.map((m: any) => `${m.role === 'user' ? 'Researcher' : 'Assistant'}: ${String(m.content || '').slice(0, 1500)}`).join('\n') + '\n\n' : ''}Researcher: ${msg || 'Give me a brief status of the protocol — what is done, running, blocked, or waiting for approval, and what I should look at next.'}`;
      let out = '';
      try { out = await callClaude(system, user, model); } catch (_e) { return json({ error: 'AI is unavailable — try again.' }, 502); }
      return json({ ok: true, reply: out });
    }

    return json({ error: 'unknown action: ' + action }, 400);
  } catch (e) { return json({ error: String(e) }, 500); }
});
