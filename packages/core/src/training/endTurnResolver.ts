/**
 * endTurnResolver — the mentor-as-EndTurn-judge (operator design 2026-09-04). The finish-side twin of
 * the lift planner (liftPlanner.ts): when the junior declares done, a bounded max-reasoning mentor
 * adjudicates ONE question — does the environment + work product actually meet the task's REAL
 * requirements (the hidden grader's criteria, not the junior's own tests)? — and answers YES (finish)
 * or NO + a concrete fix plan handed back for the junior to execute.
 *
 * WHY (strict-bug audit 2026-09-04): the mechanical strict gate rejects the narrow-door action model
 * and forces IT to reason its way to a valid attestation — the one thing the narrow door forecloses,
 * which is what produces the EndTurn rejection loops (D-B/D-D). Rerouting the finish adjudication to
 * the mentor quarantines that reasoning where it belongs and hands the action model a plan, not a
 * puzzle. Same delivery as the lift planner: orchestrator-invoke → system-reminder. Pure + testable.
 */

export interface EndTurnResolverConfig {
  outputBudgetTokens: number;
  effort: string;
  /** Max GAP verdicts that reject-and-replan before the gate fallback-accepts (liveness beats loops). */
  maxRejects: number;
}

const DEFAULTS: EndTurnResolverConfig = { outputBudgetTokens: 4000, effort: 'max', maxRejects: 2 };

export function resolveEndTurnResolverConfig(env: NodeJS.ProcessEnv = process.env): EndTurnResolverConfig {
  const n = parseInt((env.CORTEX_ENDTURN_RESOLVER_BUDGET_TOKENS ?? '').trim(), 10);
  const e = (env.CORTEX_ENDTURN_RESOLVER_EFFORT ?? '').trim();
  const m = parseInt((env.CORTEX_ENDTURN_RESOLVER_MAX_REJECTS ?? '').trim(), 10);
  return {
    outputBudgetTokens: Number.isInteger(n) && n > 0 ? n : DEFAULTS.outputBudgetTokens,
    effort: e || DEFAULTS.effort,
    maxRejects: Number.isInteger(m) && m >= 0 ? m : DEFAULTS.maxRejects,
  };
}

/** The judge persona. First line is a machine-parseable verdict; a GAP is followed by a fix plan. */
export const RESOLVER_SYSTEM =
  'You are a senior engineer performing the FINAL adjudication of a junior agent\'s work in a real ' +
  'terminal container. You are given the original TASK, an ENVIRONMENT REPORT, and the WORK PRODUCT the ' +
  'junior produced (its final answer + the checks it ran). Answer exactly ONE question: does the work ' +
  'product ACTUALLY meet the task\'s real requirements — the criteria the hidden grader will check, NOT ' +
  'the junior\'s own tests?\n' +
  'Be adversarial: hunt for the exact constraint a nearly-done agent misses — a wrong output artifact, ' +
  'a filename/path/format mismatch, a numeric threshold, a missing edge case (e.g. a NOT_FOUND status, an ' +
  'off-by-one, an unhandled input), or "passed my own test but not the task\'s".\n' +
  'FORMAT — your FIRST line MUST be exactly one of:\n' +
  '  VERDICT: MEETS\n' +
  '  VERDICT: GAP\n' +
  'If MEETS: stop after that line (optionally one short confirming clause).\n' +
  'If GAP: after the verdict line, give a SHORT numbered FIX PLAN — name each unmet requirement, then the ' +
  'concrete step(s) to close it and the exact check to verify it against the TASK\'s criteria. If a gap ' +
  'cannot be verified in this box, say so and tell the junior to note it in open_items and finish. Be ' +
  'terse and concrete; do not rewrite the whole solution.';

export interface EndTurnResolverContext {
  /** The task statement the junior received. */
  task: string;
  /** The orchestrator-gathered environment report (ENV_RECON_COMMAND output). */
  envReport?: string;
  /** The work product: the junior's final answer text + a summary of the artifacts/outputs this task. */
  workProduct: string;
  /** The junior's own EndTurn attestation (requirements/verification), if any — what IT claims it did. */
  attestation?: string;
}

/** Build the user prompt for the judge. Bounded slices keep the call cheap and cache-stable. */
export function buildResolverUserPrompt(ctx: EndTurnResolverContext): string {
  const parts: string[] = [];
  parts.push(`TASK:\n${(ctx.task || '').trim().slice(0, 2500)}`);
  const env = (ctx.envReport || '').trim();
  if (env) parts.push(`ENVIRONMENT REPORT:\n${env.slice(0, 2500)}`);
  parts.push(`WORK PRODUCT (what the junior produced + the checks it ran this task):\n${(ctx.workProduct || '').trim().slice(0, 5000)}`);
  const att = (ctx.attestation || '').trim();
  if (att) parts.push(`THE JUNIOR'S OWN ATTESTATION (treat as a claim to VERIFY, not as truth):\n${att.slice(0, 2000)}`);
  parts.push(
    'Adjudicate now. First line: `VERDICT: MEETS` or `VERDICT: GAP`. If GAP, add the numbered fix plan ' +
      'anchored to the TASK\'s real criteria.',
  );
  return parts.join('\n\n');
}

export interface ResolverVerdict {
  /** true = MEETS (finish); false = GAP (reject + fix plan). Defaults to MEETS on an unparseable/empty
   *  response (fail-open: never trap the junior on a broken judge call — liveness beats purity). */
  meets: boolean;
  /** The fix plan (GAP only). */
  plan: string;
  /** Whether the verdict line was actually found (else it fell back to fail-open MEETS). */
  parsed: boolean;
}

/** Parse the judge's response. Fail-open to MEETS when the verdict line is absent/empty. */
export function parseResolverVerdict(text: string): ResolverVerdict {
  const t = (text || '').trim();
  if (!t) return { meets: true, plan: '', parsed: false };
  const m = t.match(/VERDICT:\s*(MEETS|GAP)/i);
  if (!m) return { meets: true, plan: '', parsed: false }; // no clear verdict → do not block the finish
  const meets = m[1]!.toUpperCase() === 'MEETS';
  // The plan is everything after the verdict line.
  const idx = t.indexOf(m[0]);
  const plan = t.slice(idx + m[0].length).trim();
  return { meets, plan, parsed: true };
}
