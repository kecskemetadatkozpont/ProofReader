#!/usr/bin/env node
// ============================================================================
//  Publify — Protocol runner (runs on YOUR dedicated machine).
//  Claims a 'ready' research protocol assigned to this RUNNER_ID, then executes
//  its steps with Claude Code, in dependency order, respecting your approval
//  gates. Status + results are written back to Supabase so the Publify Protocol
//  tab shows live progress.
//
//  Requires: Node 18+ and the Claude Code CLI (`claude`) installed & logged in.
//  Env:
//    SUPABASE_URL          e.g. https://jokqthwszkweyqmmdesn.supabase.co
//    SUPABASE_SERVICE_KEY  the service-role key (KEEP IT ON THIS MACHINE ONLY)
//    RUNNER_ID             must match the "Runner ID" you set on the protocol
//    REPO_DIR              working dir for the steps (your project repo). default: cwd
//  Run:  RUNNER_ID=gpu-box REPO_DIR=~/proj node protocol-runner.mjs
// ============================================================================
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const RUNNER = process.env.RUNNER_ID;
const CWD = process.env.REPO_DIR || process.cwd();
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowISO = () => new Date().toISOString();

async function rest(path, opts = {}) {
  const r = await fetch(URL + '/rest/v1/' + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error('REST ' + r.status + ': ' + t.slice(0, 300));
  return t ? JSON.parse(t) : null;
}
const steps = (pid) => rest(`research_protocol_steps?protocol_id=eq.${pid}&select=*&order=ord.asc`);
const patchStep = (id, patch) => rest(`research_protocol_steps?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
const patchProt = (id, patch) => rest(`research_protocols?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
const heartbeat = (id, progress) => patchProt(id, { heartbeat_at: nowISO(), progress: progress || {} });

async function claim() {
  const ready = await rest(`research_protocols?status=eq.ready&runner_id=eq.${encodeURIComponent(RUNNER)}&select=*&order=updated_at.asc&limit=1`);
  if (!ready || !ready.length) return null;
  // atomic claim: the status=eq.ready filter means only ONE runner wins the PATCH
  const upd = await rest(`research_protocols?id=eq.${ready[0].id}&status=eq.ready`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'running', claimed_at: nowISO(), heartbeat_at: nowISO() }),
  });
  return upd && upd.length ? upd[0] : null;
}

function runClaude(prompt) {
  return new Promise((res) => {
    execFile('claude', ['-p', prompt, '--output-format', 'json', '--permission-mode', 'acceptEdits'],
      { cwd: CWD, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => res({ err, stdout: stdout || '', stderr: stderr || '' }));
  });
}

// Download a step's attachments (uploaded in the Task editor) into REPO_DIR/task_<ord>_files/<name>, preserving folders.
async function fetchAttachments(s, sx) {
  const atts = Array.isArray(sx.attachments) ? sx.attachments : [];
  if (!atts.length) return [];
  const base = join(CWD, `task_${s.ord}_files`);
  const local = [];
  for (const a of atts) {
    try {
      const r = await fetch(`${URL}/storage/v1/object/research-data/${a.storage_path}`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
      if (!r.ok) { console.log(`  attachment ${a.name} download failed: ${r.status}`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      const dest = join(base, (a.name || 'file').replace(/^\/+/, ''));
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      local.push({ path: `task_${s.ord}_files/${a.name}`, note: a.note || '' });
    } catch (e) { console.log(`  attachment ${a.name} error: ${e.message || e}`); }
  }
  if (local.length) console.log(`  downloaded ${local.length} attachment(s) → task_${s.ord}_files/`);
  return local;
}

async function runStep(s) {
  await patchStep(s.id, { status: 'running', started_at: nowISO(), attempts: (s.attempts || 0) + 1 });
  const sx = s.spec || {};
  const localAtts = await fetchAttachments(s, sx);
  const prompt =
    `You are autonomously executing step ${s.ord} of a research protocol on this machine. The working directory is the project repo.\n\n` +
    `STEP: ${s.title}\n` +
    `INSTRUCTION: ${sx.instruction || ''}\n` +
    (sx.inputs?.length ? `INPUTS: ${sx.inputs.join(', ')}\n` : '') +
    (localAtts.length ? `ATTACHED FILES (already downloaded for you):\n${localAtts.map((a) => `  - ${a.path}${a.note ? ` — ${a.note}` : ''}`).join('\n')}\n` : '') +
    (sx.expected_outputs?.length ? `EXPECTED OUTPUTS: ${sx.expected_outputs.join(', ')}\n` : '') +
    (sx.acceptance?.length ? `ACCEPTANCE CRITERIA: ${sx.acceptance.join('; ')}\n` : '') +
    (sx.command_hint ? `SUGGESTED COMMAND: ${sx.command_hint}\n` : '') +
    `\nDo the work end-to-end. Verify the acceptance criteria. On the FINAL line print ONLY a JSON object: ` +
    `{"ok":true|false,"metrics":{...},"artifacts":["relative/paths"],"note":"one line"}.`;
  const { err, stdout } = await runClaude(prompt);
  const result = { log_tail: stdout.slice(-3000) };
  try { const m = stdout.match(/\{[\s\S]*\}\s*$/); if (m) Object.assign(result, JSON.parse(m[0])); } catch { /* leave log_tail only */ }
  const ok = result.ok !== false && !err;
  await patchStep(s.id, { status: ok ? 'done' : 'failed', finished_at: nowISO(), result: { ...result, error: ok ? null : (err ? String(err) : 'step reported failure') } });
  console.log(`  step ${s.ord} (${s.title}) → ${ok ? 'done' : 'FAILED'}`);
  return ok;
}

async function execProtocol(prot) {
  console.log(`Claimed protocol "${prot.title}" (${prot.id})`);
  for (;;) {
    const cur = await rest(`research_protocols?id=eq.${prot.id}&select=status`);
    if (!cur.length || cur[0].status !== 'running') { console.log('protocol no longer running — releasing.'); return; }
    const st = await steps(prot.id);
    const doneOrds = new Set(st.filter((s) => s.status === 'done' || s.status === 'skipped').map((s) => s.ord));
    const depsMet = (s) => (s.depends_on || []).every((o) => doneOrds.has(o));

    if (st.every((s) => s.status === 'done' || s.status === 'skipped')) {
      await patchProt(prot.id, { status: 'done', updated_at: nowISO() });
      console.log('✓ protocol complete'); return;
    }
    // pick the next runnable step (todo without approval, or already-approved 'queued')
    const next = st.find((s) => depsMet(s) && (s.status === 'queued' || (s.status === 'todo' && !s.needs_approval)));
    if (next) {
      await heartbeat(prot.id, { phase: 'running step ' + next.ord, current_step: next.ord, done: doneOrds.size, total: st.length });
      await runStep(next);
      continue;
    }
    // nothing runnable now: mark approval-needed steps as blocked (awaiting the user), then wait
    const toBlock = st.find((s) => depsMet(s) && s.status === 'todo' && s.needs_approval);
    if (toBlock) { await patchStep(toBlock.id, { status: 'blocked', result: { ...(toBlock.result || {}), note: 'Awaiting your approval in Publify.' } }); }
    const anyFailed = st.some((s) => s.status === 'failed');
    if (anyFailed && !st.some((s) => s.status === 'blocked' || (s.status === 'todo' && depsMet(s)))) {
      await patchProt(prot.id, { status: 'failed', updated_at: nowISO() });
      console.log('✗ protocol failed (a step failed and nothing else can run)'); return;
    }
    await heartbeat(prot.id, { phase: 'waiting (approval or blocked steps)', done: doneOrds.size, total: st.length });
    await sleep(8000);
  }
}

async function main() {
  if (!URL || !KEY || !RUNNER) { console.error('Set SUPABASE_URL, SUPABASE_SERVICE_KEY and RUNNER_ID.'); process.exit(1); }
  console.log(`Protocol runner "${RUNNER}" — repo: ${CWD} — polling every 10s…`);
  for (;;) {
    try { const p = await claim(); if (p) await execProtocol(p); }
    catch (e) { console.error('runner error:', e.message || e); }
    await sleep(10000);
  }
}
main();
