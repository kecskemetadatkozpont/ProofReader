// Publify — shared per-call AI cost logger (migration-113).
//
// Records tokens + computed $ cost per user/project/function via the ai_cost_log RPC. Fire-and-forget and
// FAIL-OPEN: cost tracking must NEVER block, delay, or fail the user's request. If the migration isn't applied
// yet, the RPC errors and we silently ignore it. Deployed automatically (edges bundle imported local files).
//
// Usage (after each Anthropic response):
//   logAiCost(sb, { fn: 'research-chat', project_id, model, usage: out.usage });
//   logAiCost(sb, { fn: 'claude-session', model, input: inTok, output: outTok });   // streaming: tokens captured from SSE

type Usage = { input_tokens?: number; output_tokens?: number } | null | undefined;

export function logAiCost(
  sb: any,
  opts: { fn: string; model: string; project_id?: string | null; usage?: Usage; input?: number; output?: number; user_id?: string | null },
): void {
  try {
    const inTok = Math.max(0, Math.round(opts.input ?? opts.usage?.input_tokens ?? 0));
    const outTok = Math.max(0, Math.round(opts.output ?? opts.usage?.output_tokens ?? 0));
    if (!inTok && !outTok) return;   // nothing to record (e.g. a failed call)
    const args: Record<string, unknown> = {
      p_project: opts.project_id ?? null,
      p_fn: String(opts.fn || '?').slice(0, 64),
      p_model: String(opts.model || '?').slice(0, 80),
      p_in: inTok,
      p_out: outTok,
      // ALWAYS name p_user (null on a normal user call — the SQL pins those to auth.uid() anyway). The live DB has
      // BOTH overloads (5-arg migration-113 + 6-arg migration-115), and a call WITHOUT p_user is ambiguous for
      // PostgREST (PGRST203) → nothing was recorded, and the swallowed error hid it: almost every cost row was lost.
      // Naming it resolves to the 6-arg function; only if that one is missing (PGRST202) do we fall back to 5 args.
      p_user: opts.user_id ?? null,
    };
    sb.rpc('ai_cost_log', args).then((r: any) => {
      if (!r || !r.error) return;
      if (r.error.code === 'PGRST202') {
        const rest = Object.assign({}, args); delete rest.p_user;
        sb.rpc('ai_cost_log', rest).then((r2: any) => { if (r2 && r2.error) console.warn('[aicost] ai_cost_log (5-arg) failed:', r2.error.code, r2.error.message); }, () => {});
      } else {
        console.warn('[aicost] ai_cost_log failed:', r.error.code, r.error.message);   // fail-open, but never silent again
      }
    }, (e: any) => { console.warn('[aicost] ai_cost_log threw:', String(e)); });   // never affect the request
  } catch { /* never affect the request */ }
}

// Accumulate token usage across MULTIPLE Anthropic calls (e.g. the agent swarm) → log ONE combined event at the end.
export function makeUsageAccumulator() {
  let input = 0, output = 0;
  return {
    add(u: Usage) { if (u) { input += Math.max(0, u.input_tokens || 0); output += Math.max(0, u.output_tokens || 0); } },
    addTokens(i: number, o: number) { input += Math.max(0, i || 0); output += Math.max(0, o || 0); },
    get input() { return input; },
    get output() { return output; },
  };
}
