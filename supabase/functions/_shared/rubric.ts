// Publify — weighted, anchored rubric scorer (AI-as-judge primitive).
//
// The two-mode anchored 0-100 scale and the "no human on the other end" execution protocol are adapted from
// ResearchClawBench (InternScience, MIT licence) — arXiv:2606.07591, evaluation/score.py + instructions_tmpl.py.
//
// The single rule this exists to enforce: the model that DID the work must not be the model that decides
// whether the work is good. The caller resolves a separate judge model (resolveJudgeModel) and, when that
// separation cannot be made, `self_judged` says so out loud instead of hiding it.
//
// Deliberate departures from RCB, and why:
//   • a failed scoring is `score: null` and drops out of the weighted mean (RCB scores it 0). An API error is
//     not a scientific finding; a silent 0 would quietly drag the verdict down.
//   • concurrency 4 (RCB: 16) — Supabase edge runtime wall-clock and memory.
//   • the "50" anchor is a caller-supplied reference_label; we do not always have a target paper.
//   • prompt caching on the shared prefix: every item repeats the same candidate, so without it a 20-item
//     rubric pays for the same 3k-token material 20 times.
import { resolveJudgeModel } from './entitlement.ts';
import { logAiCost } from './aicost.ts';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export type RubricItem = {
  key: string;
  content: string;                 // the criterion itself
  weight?: number;                 // default 1
  keywords?: string[];             // concrete things the judge must look for
  type?: 'text' | 'image';         // 'image' is skipped (P1)
};

export type RubricItemScore = {
  key: string;
  weight: number;
  score: number | null;            // null = the judge could not score it (NOT 0)
  reasoning: string;
  mode: 'A' | 'B' | null;
  status: 'scored' | 'failed' | 'skipped';
};

export type RubricResult = {
  items: RubricItemScore[];
  total: number | null;
  scored_weight: number;
  total_weight: number;
  coverage: number;
  partial: boolean;
  judge_model: string;
  self_judged: boolean | null;     // null = the author model is unknown (honest "we cannot tell")
  calls: number;
};

const CAP_CONTEXT = 4000, CAP_REFERENCE = 6000, CAP_CANDIDATE = 12000;
const TRUNC_NOTE = '\n\n[…the material was truncated for length…]';

const JUDGE_SYS = (referenceLabel: string) => `You are a strict, skeptical reviewer. Score ONE criterion against the supplied material.

Your ONLY job is to SCORE. Do NOT solve the task, do NOT rewrite the material, do NOT suggest improvements.

## Reference point
The score 50 means: **${referenceLabel}**. Below 50 is worse than that, above 50 is better.

## Pick the evaluation mode first
### Mode A — quantitative (numbers, metrics, measurable outcomes)
- 0: the criterion is completely absent from the material.
- 1-10: mentioned, but no quantitative result is given.
- 11-20: numbers are given, but the method behind them has a fundamental error.
- 21-30: significant methodological flaws; values deviate severely from the reference point.
- 31-40: method mostly correct, but the values are clearly worse than the reference point.
- 41-50: values are roughly at the reference point.
- 51-70: measurably better than the reference point.
- 71-90: both method and values are substantially better.
- 91-100: a breakthrough far beyond the reference point.

### Mode B — qualitative (reasoning, mechanism, interpretation, argument)
- 0: the criterion is completely absent.
- 1-10: mentioned only with vague, generic statements.
- 11-20: described, but with no substantive analysis.
- 21-30: analysis attempted, but the evidence is insufficient or the logic has gaps.
- 31-40: right direction, but shallow; key arguments are missing.
- 41-50: depth and rigor roughly at the reference point.
- 51-70: more evidence / a more complete logical chain than the reference point.
- 71-90: significantly deeper, with insights beyond it.
- 91-100: original contribution with breakthrough insight.

## Hard rules
- Vague or generic statements earn NO credit. Demand specific, concrete evidence.
- Length is not quality. A long, well-written but shallow answer scores LOW.
- Be highly skeptical: AI-written material often sounds plausible while containing fabricated numbers or
  unsupported conclusions. If a claim is not backed by something visible in the material, it does not count.
- A claim that the work succeeded is NOT evidence that it succeeded. Score what is demonstrated, not what is asserted.
- If the material does not let you judge the criterion at all, return score 0 and say so — do NOT guess.
- Score ONLY this one criterion. Ignore everything else the material does well or badly.

Return ONLY a JSON object, no prose, no fences:
{"mode":"A"|"B","score":<0-100>,"reasoning":"<2-3 sentences, concrete, quoting what you found or what was missing>"}`;

function clip(v: string | undefined, cap: number): string {
  const t = String(v || '').trim();
  return t.length > cap ? t.slice(0, cap) + TRUNC_NOTE : t;
}

async function callJudge(model: string, sysText: string, sharedText: string, itemText: string) {
  const body = {
    model,
    max_tokens: 600,
    temperature: 0,
    // Two cache breakpoints: the system prompt and the shared material. Only the trailing criterion varies,
    // so items 2..N read the (identical) prefix from cache instead of paying for it again.
    system: [{ type: 'text', text: sysText, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: sharedText, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: itemText },
      ],
    }],
  };
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const o = await r.json();
  if (o.error) throw new Error(o.error.message || 'anthropic');
  const text = (o.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
  return { text, usage: o.usage };
}

export async function scoreRubric(sb: any, opts: {
  fn: string;
  items: RubricItem[];
  candidate: string;
  context?: string;
  reference_label?: string;
  reference?: string;
  project_id?: string | null;
  lang?: string;
  judge_model?: string;
  author_model?: string | null;
  concurrency?: number;
  max_items?: number;
}): Promise<RubricResult> {
  if (!opts.candidate || !opts.candidate.trim()) throw new Error('empty candidate');
  const all = (opts.items || []).filter((i) => i && i.content && String(i.content).trim());
  if (!all.length) throw new Error('empty rubric');
  const items = all.slice(0, Math.max(1, Math.min(opts.max_items ?? 24, 24)));
  const conc = Math.max(1, Math.min(opts.concurrency ?? 4, 6));
  const judge = opts.judge_model || await resolveJudgeModel(sb);
  const refLabel = opts.reference_label || 'the stated criterion, fully met';

  const sysText = JUDGE_SYS(refLabel) + (opts.lang === 'hu' ? '\n\nWrite the "reasoning" field in Hungarian. Keep the JSON keys and the "mode" value in English.' : '');
  const sharedText = [
    opts.context ? '## What the author was asked to do\n' + clip(opts.context, CAP_CONTEXT) : '',
    opts.reference ? '## Reference material (what "50" looks like)\n' + clip(opts.reference, CAP_REFERENCE) : '',
    '## Material under evaluation\n' + clip(opts.candidate, CAP_CANDIDATE),
  ].filter(Boolean).join('\n\n');

  let inTok = 0, outTok = 0, calls = 0;
  const scored: RubricItemScore[] = new Array(items.length);

  async function runOne(idx: number) {
    const it = items[idx];
    const weight = Number.isFinite(it.weight as number) && (it.weight as number) > 0 ? (it.weight as number) : 1;
    if (it.type === 'image') { scored[idx] = { key: it.key, weight, score: null, reasoning: 'Image criteria are not scored yet.', mode: null, status: 'skipped' }; return; }
    const itemText = '## Criterion to score\n' + String(it.content).trim()
      + (it.keywords && it.keywords.length ? '\n\n## Specific things to verify\n' + it.keywords.join('; ') : '');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { text, usage } = await callJudge(judge, sysText, sharedText, itemText);
        calls++;
        if (usage) { inTok += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0); outTok += usage.output_tokens || 0; }
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('model returned no JSON');
        const p = JSON.parse(m[0]);
        const n = Math.round(Number(p.score));
        if (!Number.isFinite(n)) throw new Error('no numeric score');
        scored[idx] = {
          key: it.key, weight, score: Math.max(0, Math.min(100, n)),
          reasoning: String(p.reasoning || '').slice(0, 900),
          mode: (p.mode === 'A' || p.mode === 'B') ? p.mode : null, status: 'scored',
        };
        return;
      } catch (e) {
        if (attempt === 1) scored[idx] = { key: it.key, weight, score: null, reasoning: String(e).slice(0, 300), mode: null, status: 'failed' };
      }
    }
  }

  // The FIRST item runs alone so it writes the shared prefix into the cache; the rest then read it.
  // Running all of them in parallel from the start would produce N cache misses instead of one.
  await runOne(0);
  for (let i = 1; i < items.length; i += conc) {
    await Promise.all(items.slice(i, i + conc).map((_, k) => runOne(i + k)));
  }

  const total_weight = scored.reduce((a, s) => a + s.weight, 0);
  const ok = scored.filter((s) => s.status === 'scored' && s.score != null);
  const scored_weight = ok.reduce((a, s) => a + s.weight, 0);
  const total = scored_weight > 0
    ? Math.round((ok.reduce((a, s) => a + (s.score as number) * s.weight, 0) / scored_weight) * 100) / 100
    : null;

  if (inTok || outTok) logAiCost(sb, { fn: opts.fn, model: judge, project_id: opts.project_id ?? null, input: inTok, output: outTok });

  return {
    items: scored, total, scored_weight, total_weight,
    coverage: total_weight > 0 ? Math.round((scored_weight / total_weight) * 100) / 100 : 0,
    partial: scored_weight < total_weight,
    judge_model: judge,
    self_judged: opts.author_model === undefined || opts.author_model === null ? null : opts.author_model === judge,
    calls,
  };
}

// Verdict thresholds. NOTE: these are aligned to the anchored scale above, where 41-50 already means
// "roughly at the reference point" — i.e. the criterion IS met. A `met` cut at 50 (as first specified)
// would have labelled a fully-met criterion "weak" most of the time.
export function verdictOf(total: number | null): 'met' | 'weak' | 'not_met' | 'unknown' {
  if (total == null) return 'unknown';
  if (total >= 41) return 'met';
  if (total >= 25) return 'weak';
  return 'not_met';
}
