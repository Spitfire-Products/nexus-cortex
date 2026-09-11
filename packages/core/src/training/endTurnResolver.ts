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
  /** ABSTENTION (CORTEX_ENDTURN_RESOLVER_ABSTAIN): offer the judge a RETIRE verdict for a
   *  structurally-hopeless finish and HONOR it (accept + stop) instead of burning the reject
   *  cycles on a task the junior can't fix. Dark by default (A/B-able). */
  abstain: boolean;
}

const DEFAULTS: EndTurnResolverConfig = { outputBudgetTokens: 4000, effort: 'max', maxRejects: 2, abstain: false };

export function resolveEndTurnResolverConfig(env: NodeJS.ProcessEnv = process.env): EndTurnResolverConfig {
  const n = parseInt((env.CORTEX_ENDTURN_RESOLVER_BUDGET_TOKENS ?? '').trim(), 10);
  const e = (env.CORTEX_ENDTURN_RESOLVER_EFFORT ?? '').trim();
  const m = parseInt((env.CORTEX_ENDTURN_RESOLVER_MAX_REJECTS ?? '').trim(), 10);
  return {
    outputBudgetTokens: Number.isInteger(n) && n > 0 ? n : DEFAULTS.outputBudgetTokens,
    effort: e || DEFAULTS.effort,
    maxRejects: Number.isInteger(m) && m >= 0 ? m : DEFAULTS.maxRejects,
    abstain: (env.CORTEX_ENDTURN_RESOLVER_ABSTAIN ?? '').trim().toLowerCase() === 'true',
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
  'terse and concrete; do not rewrite the whole solution.\n' +
  'EVIDENCE RULE (HB-JUDGE-GROUNDING): judge the ARTIFACT, not the prose. When a WORKSPACE DELTA and/or a CHECK RUN ' +
  'are provided, they are the ground truth: a GAP must name a concrete defect you can point at in the delta or a ' +
  'failed check; a MEETS must point at a passing check or the delta content that satisfies each criterion. Do not ' +
  'GAP on suspicion of the junior\'s wording when the delta shows the artifact meets the criteria, and do not MEETS ' +
  'on the junior\'s claim when the check failed or the artifact is missing from the delta.';

/** Appended to the persona when abstention is enabled — offers the conservative RETIRE verdict. */
export const RESOLVER_ABSTAIN_CLAUSE =
  '\n\nA THIRD verdict is available: `VERDICT: RETIRE`. Use it ONLY when the work does not meet requirements ' +
  'AND the gap is structurally UNCLOSABLE by this junior in the remaining budget — a fundamentally wrong ' +
  'approach it keeps repeating, a missing capability/dependency that cannot be obtained in this box, or an ' +
  'impossible / self-contradictory requirement. RETIRE ends the task as-is instead of dispatching another ' +
  'doomed fix cycle. 🔴 When in doubt between GAP and RETIRE, choose GAP — only RETIRE when you are CONFIDENT ' +
  'that more attempts cannot help. After `VERDICT: RETIRE`, give ONE short line naming why it is unclosable.';

/** The persona for the judge. With `abstain`, the RETIRE option is offered. */
export function resolverSystemPrompt(abstain = false): string {
  return abstain ? RESOLVER_SYSTEM + RESOLVER_ABSTAIN_CLAUSE : RESOLVER_SYSTEM;
}

export interface EndTurnResolverContext {
  /** The task statement the junior received. */
  task: string;
  /** The orchestrator-gathered environment report (ENV_RECON_COMMAND output). */
  envReport?: string;
  /** The work product: the junior's final answer text + a summary of the artifacts/outputs this task. */
  workProduct: string;
  /** The junior's own EndTurn attestation (requirements/verification), if any — what IT claims it did. */
  attestation?: string;
  /** HB-JUDGE-GROUNDING: files changed this task + a bounded head of each (collectWorkspaceDelta). */
  workspaceDelta?: string;
  /** HB-JUDGE-GROUNDING: the labeled result of running an evident check entry point (runCheck). */
  checkResult?: string;
  /** 4.107.0: the lift planner's PLAN OF ATTACK delivered to the junior at lift (advisory anchor — the judge holds the
   *  junior to the bar it was steered to and says where the plan and the TASK disagree; the TASK wins). */
  liftPlan?: string;
}

/** Build the user prompt for the judge. Bounded slices keep the call cheap and cache-stable. */
export function buildResolverUserPrompt(ctx: EndTurnResolverContext, abstain = false): string {
  const parts: string[] = [];
  parts.push(`TASK:\n${(ctx.task || '').trim().slice(0, 2500)}`);
  const lift = (ctx.liftPlan || '').trim();
  if (lift) parts.push(`PLAN OF ATTACK (stated at lift by the planner — ADVISORY: judge against the TASK's real criteria; where the plan and the TASK disagree, the TASK wins — say so in one line):\n${lift.slice(0, 3500)}`);
  const env = (ctx.envReport || '').trim();
  if (env) parts.push(`ENVIRONMENT REPORT:\n${env.slice(0, 2500)}`);
  const delta = (ctx.workspaceDelta || '').trim();
  if (delta) parts.push(`WORKSPACE DELTA — THE ARTIFACT (files changed this task, with heads; ground truth):\n${delta.slice(0, 6000)}`);
  const check = (ctx.checkResult || '').trim();
  if (check) parts.push(`CHECK RUN (an evident check entry point, executed by the harness just now; ground truth):\n${check.slice(0, 3000)}`);
  parts.push(`WORK PRODUCT (the junior's final answer + its most recent checks/tool outputs):\n${(ctx.workProduct || '').trim().slice(0, 5000)}`);
  const att = (ctx.attestation || '').trim();
  if (att) parts.push(`THE JUNIOR'S OWN ATTESTATION (treat as a claim to VERIFY, not as truth):\n${att.slice(0, 2000)}`);
  parts.push(
    abstain
      ? 'Adjudicate now. First line: `VERDICT: MEETS`, `VERDICT: GAP`, or `VERDICT: RETIRE`. If GAP, add the ' +
          'numbered fix plan anchored to the TASK\'s real criteria; if RETIRE, one line on why it is unclosable.'
      : 'Adjudicate now. First line: `VERDICT: MEETS` or `VERDICT: GAP`. If GAP, add the numbered fix plan ' +
          'anchored to the TASK\'s real criteria.',
  );
  return parts.join('\n\n');
}

export interface ResolverVerdict {
  /** true = MEETS (finish); false = GAP, RETIRE or BLANK. A blank/unparseable response is NOT a MEETS: it is
   *  `blank:true` and the orchestrator ABSTAINS (finish accepted, no veto, banked as a judge failure) — never
   *  counted as a judgment (operator decision 2026-09-10 after the cell-m pilot's fail-open rubber-stamps). */
  meets: boolean;
  /** RETIRE = the finish does not meet requirements AND is structurally unclosable → abstain (accept
   *  + stop the reject loop) when CORTEX_ENDTURN_RESOLVER_ABSTAIN is on. Never true for MEETS/GAP. */
  retire: boolean;
  /** GAP: the fix plan. RETIRE: the one-line reason it is unclosable. */
  plan: string;
  /** Whether the verdict line was actually found. */
  parsed: boolean;
  /** The judge returned nothing usable (empty text or no VERDICT line) → the orchestrator abstains. */
  blank: boolean;
}

/** Parse the judge's response. Empty/verdict-less text → `blank` (ABSTAIN), never MEETS. */
export function parseResolverVerdict(text: string): ResolverVerdict {
  const t = (text || '').trim();
  if (!t) return { meets: false, retire: false, plan: '', parsed: false, blank: true };
  const m = t.match(/VERDICT:\s*(MEETS|GAP|RETIRE)/i);
  if (!m) return { meets: false, retire: false, plan: '', parsed: false, blank: true }; // no clear verdict → abstain, do not block
  const verdict = m[1]!.toUpperCase();
  const meets = verdict === 'MEETS';
  const retire = verdict === 'RETIRE';
  // The plan (GAP) / reason (RETIRE) is everything after the verdict line.
  const idx = t.indexOf(m[0]);
  const plan = t.slice(idx + m[0].length).trim();
  return { meets, retire, plan, parsed: true, blank: false };
}
