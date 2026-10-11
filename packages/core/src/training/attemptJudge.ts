/**
 * attemptJudge — the COMPARATIVE selector for a second-attempt chain (R251, CORTEX_SECOND_ATTEMPT_SELECT=judge, 2026-10-11).
 *
 * Today's EndTurn resolver rules on each attempt's finish IN ISOLATION, and selection compares only labels (verdict class),
 * turn counts and the shipped check. This module gives the judge every finished attempt at once — lift plan, resolver verdict +
 * gap notes, files changed since the task start, shipped-check output, the final response, turns — and asks for ONE ranking by
 * the likelihood that the HIDDEN grader accepts the tree as left on disk. The TASK's requirements decide, never plan quality:
 * a better plan with a weaker artifact loses. Pure builders/parsers here; the model call lives in HelperModelMiddleware.compareAttempts.
 *
 * Output contract: line 1 `RANKING: k, k, k` (every attempt, best first), line 2 `REASON: <one line>`. A blank/unparseable reply
 * falls back to the evidence order (never a hidden pick change). The shipped-check gate stays HARD: when some attempts pass the
 * workspace's own check and others do not, only the passing ones are eligible regardless of the ranking.
 */

export interface AttemptPacket {
  k: number;
  /** the planner's PLAN OF ATTACK for this attempt ('' when none) */
  liftPlan: string;
  /** the resolver's last action on this attempt (accept | accept-with-gap | accept-low-confidence | veto | … | null = no verdict) */
  action: string | null;
  confidence?: string;
  namedPassed?: number;
  /** the resolver's GAP notes / fix plan ('' when MEETS or none) */
  gapNotes: string;
  check: 'pass' | 'fail' | 'skipped' | 'none';
  checkOutput: string;
  /** `git diff --stat` lift..attempt<k> ('' when unavailable) */
  diffStat: string;
  /** the attempt's final assistant text */
  finalText: string;
  turns: number | null;
}

const CAPS = { task: 6000, plan: 2500, gap: 2000, check: 2500, diff: 2500, final: 3000 } as const;

function clip(s: string, max: number, what: string): string {
  const t = (s || '').trim();
  if (t.length <= max) return t;
  const head = Math.floor(max * 0.7); const tail = max - head;
  return `${t.slice(0, head)}\n… [${t.length - max} chars of ${what} elided] …\n${t.slice(-tail)}`;
}

export const ATTEMPT_JUDGE_SYSTEM =
  'You are a senior engineer choosing which of several INDEPENDENT attempts at the SAME task to submit to a hidden grader. ' +
  'Each attempt started from the same workspace; you see, per attempt, its plan of attack, the final adjudication it received ' +
  '(verdict, confidence, open items), the workspace\'s own check result, the files it changed, its final message and how many ' +
  'tool-call turns it took. Exactly ONE attempt\'s tree will be graded.\n' +
  'Decide by the TASK\'s real requirements — the criteria the hidden grader checks — never by plan quality: a better plan with a ' +
  'weaker artifact LOSES. Evidence precedence: a shipped check result > concrete changed files and verifiable claims in the final ' +
  'message > the resolver\'s verdict and confidence > the plan. Be adversarial: hunt for the exact constraint a nearly-done attempt ' +
  'misses (wrong artifact, path/format mismatch, numeric threshold, unhandled edge case, "passed my own test but not the task\'s"). ' +
  'Fewer turns is NOT evidence of correctness on its own.\n' +
  'FORMAT — your FIRST line MUST be exactly `RANKING: k, k, …` listing EVERY attempt number, best first. ' +
  'Second line MUST be `REASON: <one line naming the deciding evidence>`. Nothing else.';

export function buildAttemptJudgePrompt(task: string, packets: AttemptPacket[]): string {
  const parts: string[] = [`TASK:\n${clip(task, CAPS.task, 'the task text')}`];
  for (const p of [...packets].sort((a, b) => a.k - b.k)) {
    const lines: string[] = [`=== ATTEMPT ${p.k} ===`];
    lines.push(`TOOL-CALL TURNS: ${p.turns ?? 'unknown'}`);
    lines.push(`RESOLVER VERDICT: ${p.action ?? 'none (no finish adjudicated)'}` + (p.confidence ? ` | confidence ${p.confidence}` : '') + (typeof p.namedPassed === 'number' ? ` | judge checks passed ${p.namedPassed}` : ''));
    if (p.gapNotes.trim()) lines.push(`RESOLVER OPEN ITEMS (its fix plan — grade whether they are real):\n${clip(p.gapNotes, CAPS.gap, 'the open items')}`);
    lines.push(`SHIPPED CHECK (the workspace's own test entry point, run by the harness on this attempt's tree): ${p.check}` + (p.checkOutput.trim() ? `\n${clip(p.checkOutput, CAPS.check, 'the check output')}` : ''));
    if (p.diffStat.trim()) lines.push(`FILES CHANGED vs the task start (git diff --stat):\n${clip(p.diffStat, CAPS.diff, 'the diff stat')}`);
    else lines.push('FILES CHANGED vs the task start: none recorded');
    if (p.liftPlan.trim()) lines.push(`PLAN OF ATTACK (advisory; the TASK wins where they disagree):\n${clip(p.liftPlan, CAPS.plan, 'the plan')}`);
    lines.push(`FINAL MESSAGE:\n${clip(p.finalText || '(empty)', CAPS.final, 'the final message')}`);
    parts.push(lines.join('\n'));
  }
  parts.push(`Rank attempts ${packets.map((p) => p.k).sort((a, b) => a - b).join(', ')} by the likelihood that the hidden grader accepts the tree as left on disk. First line \`RANKING: …\` (every attempt, best first), second line \`REASON: …\`.`);
  return parts.join('\n\n');
}

export interface AttemptJudgeRanking {
  /** best first; every k in `ks` exactly once (unranked attempts appended in the order given) */
  ranking: number[];
  reason: string;
  /** a RANKING line naming at least one known attempt was found */
  parsed: boolean;
}

export function parseAttemptJudgeRanking(text: string, ks: number[]): AttemptJudgeRanking {
  const t = (text || '').trim();
  const m = t.match(/RANKING:\s*([0-9][0-9,\s>→\-]*)/i);
  const known = new Set(ks);
  const out: number[] = [];
  if (m) for (const tok of m[1]!.split(/[^0-9]+/)) { const n = parseInt(tok, 10); if (Number.isFinite(n) && known.has(n) && !out.includes(n)) out.push(n); }
  const parsed = out.length > 0;
  for (const k of ks) if (!out.includes(k)) out.push(k);
  const r = t.match(/REASON:\s*(.+)/i);
  return { ranking: out, reason: (r ? r[1]! : '').trim().slice(0, 400), parsed };
}

export interface JudgePickInput {
  /** finished attempts only, with their shipped-check result */
  candidates: Array<{ k: number; check: 'pass' | 'fail' | 'skipped' | 'none' }>;
  ranking: number[];
  /** the evidence-order pick, used when the ranking names no eligible attempt */
  fallbackPick: number;
}

/** The shipped-check gate stays hard; within the eligible set the judge's order decides. Pure. */
export function applyJudgeRanking(i: JudgePickInput): { pick: number; why: string } {
  let elig = i.candidates;
  const passing = elig.filter((c) => c.check === 'pass');
  const gated = passing.length > 0 && passing.length < elig.length;
  if (gated) elig = passing;
  const set = new Set(elig.map((c) => c.k));
  const first = i.ranking.find((k) => set.has(k));
  if (first === undefined) return { pick: i.fallbackPick, why: 'judge ranking named no eligible attempt; evidence order' };
  return { pick: first, why: (gated ? `shipped check passes only on attempt ${passing.map((c) => c.k).join(',')}; ` : '') + `judge ranking ${i.ranking.join(' > ')} (attempt ${first})` };
}
