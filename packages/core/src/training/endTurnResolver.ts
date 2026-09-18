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
  /** R160 HB-RESOLVER-BUDGET-CAP (2026-09-16): the cap that applies while >= CORTEX_BUDGET_CONTINUE_MIN_REMAINING of the
   *  wall budget remains. tb4-flash-v3: 16 of 22 confident-wrong finishes ended on a GAP verdict the judge had already
   *  stated — the second veto hit maxRejects=2 a median 24 min into an 8-h budget and the finish shipped. 0 = same as
   *  maxRejects (byte-identical); no deadline → maxRejects. */
  maxRejectsBudgeted: number;
  /** R165 HB-JUDGE-SEMANTIC (2026-09-16): the judge decides SEMANTICS; deterministic code gathers evidence and enforces limits.
   *  semantic=true drops the task-shape regex gate (adjudicate every tool-using finish), folds the open-items/surrender
   *  regex nudges into the judge when it ran, runs the judge's own named CHECK commands before the next adjudication,
   *  grades GAP by confidence, and replaces the fixed veto count with a progress condition (+ one thinking-on escalation).
   *  CORTEX_JUDGE_SEMANTIC=false restores the 4.111 gating byte-for-byte (A/B control). */
  semantic: boolean;
  /** R165: tool calls since the last veto that count as "the junior worked the plan" (CORTEX_JUDGE_PROGRESS_MIN_CALLS, default 3). */
  progressMinCalls: number;
  /** R165: on a re-attest with no progress, re-judge ONCE with reasoning on before accepting-with-gap (CORTEX_JUDGE_ESCALATE_REASONING, default on). */
  escalateReasoning: boolean;
  /** R166 HB-JUDGE-EVIDENCE-VETO (2026-09-17, tb4 A/B 38x2): the judge's first verdict was GAP on 18 of 19 solutions the grader
   *  accepted and MEETS on 22 solutions it rejected; its own named checks failed on 6 passing solutions. Opinion has no
   *  discriminative value, so opinion no longer holds a finish. CORTEX_JUDGE_VETO: 'evidence' (default) — a GAP holds the
   *  finish only when a judge-named CHECK the harness ran just now FAILED, at most evidenceCap times per session; otherwise the
   *  finish stands and the plan rides on the event (accept-with-gap). 'opinion' = the R165 policy. 'never' = record only. */
  vetoMode: 'evidence' | 'opinion' | 'never';
  /** R166: max evidence-backed vetoes per session (CORTEX_JUDGE_EVIDENCE_MAX_VETOES, default 1, 0..20). */
  evidenceCap: number;
  /** R167 HB-FINISH-CONFIRM (2026-09-17, pilot-12): Terminus-2's "are you sure" made informative. When the judge accepts a
   *  finish WITH a recorded gap (accept-with-gap / accept-low-confidence) and >= finishConfirmMinRemaining of the wall budget
   *  remains, the finish is HELD once (finishConfirmMax) with a zero-model-call message carrying the budget left, the judge's
   *  gap plan and the junior's own open_items; the junior either continues or calls EndTurn again (which stands unless an
   *  evidence veto applies). Pilot-12 evidence: coq-block-bound surrendered honestly at 73% budget left and the R165 deferral
   *  silenced the budget-continue nudge; 8/12 first finishes per arm had >= 70% budget left. CORTEX_FINISH_CONFIRM=false = off. */
  finishConfirm: boolean;
  finishConfirmMinRemaining: number;
  finishConfirmMax: number;
  /** R168 HB-MEETS-CONFIRM (2026-09-17, pilot-12 rerun): a MEETS was unconditional — `decideVetoAction` accepted it on the
   *  verdict string alone, the judge's own CHECK lines were never run for a MEETS, and R167's hold excluded MEETS by
   *  construction. 2–3 sessions per arm finished on a wrong MEETS at 81–92% budget left and walked straight through. With
   *  meetsConfirm, the persona demands one to three `CHECK:` lines whose PASSING proves the task's own criteria; the harness
   *  runs them now; a MEETS with no passing evidence (no check named, or every check failed/inconclusive) and
   *  >= meetsConfirmMinRemaining of the wall budget left is HELD once (sharing finishConfirmMax with R167) with the check
   *  results, the budget and the junior's open_items. A MEETS backed by a passing check stands. CORTEX_MEETS_CONFIRM=false = 4.116.2. */
  meetsConfirm: boolean;
  meetsConfirmMinRemaining: number;
  /** R170 HB-JUDGE-TOOL-LOOP (2026-09-17; the v2 of LIFT_MENTOR_PLANNER_EXPERIMENT_SPEC §2.2/§2.4, built as a HARNESS-driven
   *  text protocol over the existing single-shot helper call — no adapter/tool wiring). With toolRounds > 1 the judge may answer
   *  `VERDICT: INVESTIGATE` with `CHECK: <cmd>` and `READ: <path>[:start-end]` lines instead of a verdict; the harness runs the
   *  checks (existing runCheck surface, read-only denylist) and reads the file slices, appends an EVIDENCE block, and re-asks —
   *  at most toolRounds calls per adjudication and toolRoundBudgetMs of aggregate wall clock; the last round must decide.
   *  Default 1 = 4.116.2 byte-for-byte (INVESTIGATE never offered). */
  toolRounds: number;
  toolRoundBudgetMs: number;
  /** R170b (4.117.3, rerun-3 field read): a thinking-off flash judge never CHOSE to investigate when offered (0 of 27+ adjudications
   *  at ROUNDS=3). With toolAutoLoop the loop no longer depends on the judge asking: when a first-round MEETS/GAP names `CHECK:`
   *  lines, the harness runs them and re-asks ONCE with the results before accepting the verdict — every check-naming
   *  adjudication becomes a two-round one. Needs toolRounds >= 2. CORTEX_JUDGE_TOOL_AUTOLOOP=true; default off. */
  toolAutoLoop: boolean;
  /** ABSTENTION (CORTEX_ENDTURN_RESOLVER_ABSTAIN): offer the judge a RETIRE verdict for a
   *  structurally-hopeless finish and HONOR it (accept + stop) instead of burning the reject
   *  cycles on a task the junior can't fix. Dark by default (A/B-able). */
  abstain: boolean;
}

const DEFAULTS: EndTurnResolverConfig = { outputBudgetTokens: 4000, effort: 'max', maxRejects: 2, maxRejectsBudgeted: 6, semantic: true, progressMinCalls: 3, escalateReasoning: true, vetoMode: 'evidence', evidenceCap: 1, finishConfirm: true, finishConfirmMinRemaining: 0.3, finishConfirmMax: 1, meetsConfirm: true, meetsConfirmMinRemaining: 0.5, toolRounds: 1, toolRoundBudgetMs: 240_000, toolAutoLoop: false, abstain: false };

export function resolveEndTurnResolverConfig(env: NodeJS.ProcessEnv = process.env): EndTurnResolverConfig {
  const n = parseInt((env.CORTEX_ENDTURN_RESOLVER_BUDGET_TOKENS ?? '').trim(), 10);
  const e = (env.CORTEX_ENDTURN_RESOLVER_EFFORT ?? '').trim();
  const m = parseInt((env.CORTEX_ENDTURN_RESOLVER_MAX_REJECTS ?? '').trim(), 10);
  const mb = parseInt((env.CORTEX_ENDTURN_RESOLVER_MAX_REJECTS_BUDGETED ?? '').trim(), 10);
  const sem = (env.CORTEX_JUDGE_SEMANTIC ?? '').trim().toLowerCase();
  const pm = parseInt((env.CORTEX_JUDGE_PROGRESS_MIN_CALLS ?? '').trim(), 10);
  const esc = (env.CORTEX_JUDGE_ESCALATE_REASONING ?? '').trim().toLowerCase();
  const vm = (env.CORTEX_JUDGE_VETO ?? '').trim().toLowerCase();
  const ec = parseInt((env.CORTEX_JUDGE_EVIDENCE_MAX_VETOES ?? '').trim(), 10);
  const fc = (env.CORTEX_FINISH_CONFIRM ?? '').trim().toLowerCase();
  const fmin = parseFloat((env.CORTEX_FINISH_CONFIRM_MIN_REMAINING ?? '').trim());
  const fmax = parseInt((env.CORTEX_FINISH_CONFIRM_MAX ?? '').trim(), 10);
  const mc = (env.CORTEX_MEETS_CONFIRM ?? '').trim().toLowerCase();
  const mmin = parseFloat((env.CORTEX_MEETS_CONFIRM_MIN_REMAINING ?? '').trim());
  const tr = parseInt((env.CORTEX_JUDGE_TOOL_ROUNDS ?? '').trim(), 10);
  const trb = parseInt((env.CORTEX_JUDGE_TOOL_ROUND_BUDGET_MS ?? '').trim(), 10);
  const tal = (env.CORTEX_JUDGE_TOOL_AUTOLOOP ?? '').trim().toLowerCase();
  return {
    outputBudgetTokens: Number.isInteger(n) && n > 0 ? n : DEFAULTS.outputBudgetTokens,
    effort: e || DEFAULTS.effort,
    maxRejects: Number.isInteger(m) && m >= 0 ? m : DEFAULTS.maxRejects,
    maxRejectsBudgeted: Number.isInteger(mb) && mb >= 0 ? Math.min(20, mb) : DEFAULTS.maxRejectsBudgeted,
    semantic: sem === '' ? DEFAULTS.semantic : !(sem === 'false' || sem === '0' || sem === 'off'),
    progressMinCalls: Number.isInteger(pm) && pm >= 1 ? Math.min(50, pm) : DEFAULTS.progressMinCalls,
    escalateReasoning: esc === '' ? DEFAULTS.escalateReasoning : !(esc === 'false' || esc === '0' || esc === 'off'),
    vetoMode: vm === 'opinion' || vm === 'never' || vm === 'evidence' ? vm : DEFAULTS.vetoMode,
    evidenceCap: Number.isInteger(ec) && ec >= 0 ? Math.min(20, ec) : DEFAULTS.evidenceCap,
    finishConfirm: fc === '' ? DEFAULTS.finishConfirm : !(fc === 'false' || fc === '0' || fc === 'off'),
    finishConfirmMinRemaining: Number.isFinite(fmin) && fmin >= 0 && fmin <= 1 ? fmin : DEFAULTS.finishConfirmMinRemaining,
    finishConfirmMax: Number.isInteger(fmax) && fmax >= 0 ? Math.min(5, fmax) : DEFAULTS.finishConfirmMax,
    meetsConfirm: mc === '' ? DEFAULTS.meetsConfirm : !(mc === 'false' || mc === '0' || mc === 'off'),
    meetsConfirmMinRemaining: Number.isFinite(mmin) && mmin >= 0 && mmin <= 1 ? mmin : DEFAULTS.meetsConfirmMinRemaining,
    toolRounds: Number.isInteger(tr) && tr >= 1 ? Math.min(5, tr) : DEFAULTS.toolRounds,
    toolRoundBudgetMs: Number.isInteger(trb) && trb >= 10_000 ? Math.min(1_800_000, trb) : DEFAULTS.toolRoundBudgetMs,
    toolAutoLoop: tal === 'true' || tal === '1' || tal === 'on',
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
  'Second line MUST be exactly `CONFIDENCE: high`, `CONFIDENCE: medium` or `CONFIDENCE: low` — how sure you are of the verdict ' +
  'given the evidence you were shown (low = you suspect a gap but cannot point at a failed check or a concrete defect).\n' +
  'If MEETS: stop after those lines (optionally one short confirming clause).\n' +
  'If GAP: after the verdict lines, give a SHORT numbered FIX PLAN — name each unmet requirement, then the ' +
  'concrete step(s) to close it and the exact check to verify it against the TASK\'s criteria. For every item that a single ' +
  'shell command can settle objectively, add a line `CHECK: <command>` (runs from the workspace root; exit non-zero or print ' +
  'FAIL when the requirement is unmet) — the harness will RUN it before your next adjudication and show you the result. ' +
  'If PRIOR VETO ITEMS are provided, first say for each whether it is now CLOSED (point at the evidence) or STILL OPEN; do not ' +
  'raise new items while prior ones stay open unless the new one is more severe. If a gap cannot be verified in this box, say ' +
  'so and tell the junior to note it in open_items and finish. Be terse and concrete; do not rewrite the whole solution.\n' +
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

/** R168: the MEETS sentence the persona carries by default, and its evidence-demanding replacement when meetsConfirm is on. */
export const RESOLVER_MEETS_DEFAULT_LINE = 'If MEETS: stop after those lines (optionally one short confirming clause).\n';
export const RESOLVER_MEETS_CHECK_LINE =
  'If MEETS: after the verdict lines, give ONE to THREE lines `CHECK: <command>` whose PASSING (exit 0) proves the task\'s own ' +
  'acceptance criteria — the exact artifact, output, format or threshold the TASK names, not the junior\'s own tests. The harness ' +
  'RUNS them now; a MEETS with no passing check is treated as unverified and the finish is held for the junior to prove it. Then stop.\n';

/** R170: offered while investigation rounds remain — the judge may gather evidence instead of deciding. */
export const RESOLVER_INVESTIGATE_CLAUSE =
  '\n\nYou may INVESTIGATE before deciding: if the evidence shown is not enough to point at a passing check or a concrete defect, ' +
  'answer with the first line `VERDICT: INVESTIGATE` followed by up to three `CHECK: <command>` lines (read-only commands and test ' +
  'runs; the harness executes them from the workspace root) and up to three `READ: <path>[:START-END]` lines (a file, optionally a ' +
  'line range). The harness runs them and shows you an EVIDENCE block, then asks again. Prefer commands whose exit status settles a ' +
  'requirement objectively. Do not repeat a check or read whose result you already have.';
/** R170: on the last round the option is withdrawn — the judge must decide on the evidence gathered. */
export const RESOLVER_DECIDE_NOW_CLAUSE =
  '\n\nNo further investigation is available — decide now on the evidence you have (MEETS or GAP; INVESTIGATE is no longer accepted).';

/** The persona for the judge. With `abstain`, the RETIRE option is offered; with `meetsConfirm` (R168), a MEETS must name proving
 *  checks; `investigate` (R170) = 'offer' while rounds remain, 'withdraw' on the last round of a multi-round adjudication, undefined otherwise. */
export function resolverSystemPrompt(abstain = false, meetsConfirm = false, investigate?: 'offer' | 'withdraw'): string {
  const base = meetsConfirm ? RESOLVER_SYSTEM.replace(RESOLVER_MEETS_DEFAULT_LINE, RESOLVER_MEETS_CHECK_LINE) : RESOLVER_SYSTEM;
  const withAbstain = abstain ? base + RESOLVER_ABSTAIN_CLAUSE : base;
  return investigate === 'offer' ? withAbstain + RESOLVER_INVESTIGATE_CLAUSE : investigate === 'withdraw' ? withAbstain + RESOLVER_DECIDE_NOW_CLAUSE : withAbstain;
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
  /** R165: the fix plan from the previous veto of this finish (the judge grades progress against it). */
  priorVetoItems?: string;
  /** R165: what the junior did since that veto (tool-call count, commands that touched the named checks). */
  progressSummary?: string;
  /** R170: the EVIDENCE blocks gathered by earlier investigation rounds of THIS adjudication (oldest first). */
  evidenceRounds?: string[];
}

/** R170 fix (4.117.1): the closing instruction must OFFER the same verdict set the persona does — in 4.117.0 it said
 *  "First line: MEETS or GAP" under an INVESTIGATE persona and the judge never investigated once in 25 adjudications. */
export function resolverClosingInstruction(abstain: boolean, meetsConfirm = false, investigate?: 'offer' | 'withdraw'): string {
  const meetsLine = meetsConfirm ? ' If MEETS, add the one to three `CHECK:` lines whose passing proves the task\'s own criteria.' : '';
  const gapLine = abstain
    ? ' If GAP, add the numbered fix plan anchored to the TASK\'s real criteria; if RETIRE, one line on why it is unclosable.'
    : ' If GAP, add the numbered fix plan anchored to the TASK\'s real criteria.';
  const verdicts = abstain ? '`VERDICT: MEETS`, `VERDICT: GAP`, or `VERDICT: RETIRE`' : '`VERDICT: MEETS` or `VERDICT: GAP`';
  if (investigate === 'offer') {
    return (
      'Decide whether the evidence shown SETTLES the verdict. If it does not — no passing check and no concrete defect you can point ' +
      'at — your first line is `VERDICT: INVESTIGATE`, followed by up to three `CHECK: <read-only command>` lines and up to three ' +
      '`READ: <path>[:START-END]` lines; the harness runs them and asks you again with the results. If it does settle it, adjudicate ' +
      `now: first line ${verdicts}.` + gapLine + meetsLine
    );
  }
  const decideNow = investigate === 'withdraw' ? 'No further investigation is available — decide now on the evidence you have. ' : 'Adjudicate now. ';
  return decideNow + `First line: ${verdicts}.` + gapLine + meetsLine;
}

/** Build the user prompt for the judge. Bounded slices keep the call cheap and cache-stable. */
export function buildResolverUserPrompt(ctx: EndTurnResolverContext, abstain = false, meetsConfirm = false, investigate?: 'offer' | 'withdraw'): string {
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
  const prior = (ctx.priorVetoItems || '').trim();
  if (prior) parts.push(`PRIOR VETO ITEMS (your own fix plan from the previous adjudication of this finish — grade each CLOSED or STILL OPEN before anything else):\n${prior.slice(0, 2500)}`);
  const prog = (ctx.progressSummary || '').trim();
  if (prog) parts.push(`PROGRESS SINCE THAT VETO (harness-observed, ground truth):\n${prog.slice(0, 1500)}`);
  for (const ev of ctx.evidenceRounds ?? []) { const e = (ev || '').trim(); if (e) parts.push(e.slice(0, 6000)); } // R170
  parts.push(resolverClosingInstruction(abstain, meetsConfirm, investigate));
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
  /** R165: the judge's stated confidence (defaults to high when absent — prior prompt versions had no line). */
  confidence: 'high' | 'medium' | 'low';
  /** R165: shell checks the judge named (`CHECK: <cmd>` lines), in order, deduplicated, backticks stripped. */
  checks: string[];
  /** R170: `VERDICT: INVESTIGATE` — the judge asks for evidence instead of deciding (only honored while rounds remain). */
  investigate: boolean;
  /** R170: `READ: <path>[:start-end]` lines the judge asked for, in order, deduplicated (≤4). */
  reads: string[];
}

/** Parse the judge's response. Empty/verdict-less text → `blank` (ABSTAIN), never MEETS. */
export function parseResolverVerdict(text: string): ResolverVerdict {
  const t = (text || '').trim();
  if (!t) return { meets: false, retire: false, plan: '', parsed: false, blank: true, confidence: 'high', checks: [], investigate: false, reads: [] };
  const m = t.match(/VERDICT:\s*(MEETS|GAP|RETIRE|INVESTIGATE)/i);
  if (!m) return { meets: false, retire: false, plan: '', parsed: false, blank: true, confidence: 'high', checks: [], investigate: false, reads: [] }; // no clear verdict → abstain, do not block
  const verdict = m[1]!.toUpperCase();
  const meets = verdict === 'MEETS';
  const retire = verdict === 'RETIRE';
  const investigate = verdict === 'INVESTIGATE'; // R170
  // The plan (GAP) / reason (RETIRE) is everything after the verdict line.
  const idx = t.indexOf(m[0]);
  let plan = t.slice(idx + m[0].length).trim();
  const cm = plan.match(/^\s*CONFIDENCE:\s*(high|medium|low)\b[^\n]*\n?/im);
  const confidence = (cm ? cm[1]!.toLowerCase() : 'high') as 'high' | 'medium' | 'low';
  if (cm) plan = plan.replace(cm[0], '').trim();
  const checks: string[] = [];
  const reads: string[] = [];
  for (const line of plan.split('\n')) {
    const cl = line.match(/^\s*(?:[-*\d.)]+\s*)?CHECK:\s*(.+?)\s*$/i);
    if (cl) { const cmd = cl[1]!.replace(/^`+|`+$/g, '').trim(); if (cmd && cmd.length <= 400 && !checks.includes(cmd)) checks.push(cmd); continue; }
    const rl = line.match(/^\s*(?:[-*\d.)]+\s*)?READ:\s*(.+?)\s*$/i); // R170
    if (rl) { const spec = rl[1]!.replace(/^`+|`+$/g, '').trim(); if (spec && spec.length <= 300 && !reads.includes(spec)) reads.push(spec); }
  }
  return { meets, retire, plan, parsed: true, blank: false, confidence, checks: checks.slice(0, 4), investigate, reads: reads.slice(0, 4) };
}

/** R165: what to do with a verdict. Pure, so the policy is unit-testable and readable in one place. */
export type VetoAction = 'accept' | 'veto' | 'escalate' | 'accept-with-gap' | 'accept-low-confidence';
export function decideVetoAction(input: {
  meets: boolean; blank: boolean; retire: boolean; confidence: 'high' | 'medium' | 'low';
  rejects: number; cap: number; progressed: boolean; escalated: boolean;
  /** A judge-named check ran and FAILED (objective evidence of the gap). */
  checksFailed: boolean;
  /** R166: 'evidence' (default) — only a failed harness-run check holds a finish; 'opinion' = R165; 'never' = record only. */
  vetoMode?: 'evidence' | 'opinion' | 'never';
  /** R166: max evidence-backed vetoes per session (default 1). */
  evidenceCap?: number;
}): VetoAction {
  if (input.meets || input.blank || input.retire) return 'accept';
  const mode = input.vetoMode ?? 'evidence';
  if (mode === 'never') return 'accept-with-gap';
  if (mode === 'evidence') {
    // R166: the judge asserts, the harness verifies, only a verified failure holds the finish — and only evidenceCap times.
    if (!input.checksFailed) return 'accept-with-gap';
    if (input.rejects >= Math.min(input.cap, input.evidenceCap ?? 1)) return 'accept-with-gap';
    return 'veto';
  }
  if (input.confidence === 'low' && !input.checksFailed) return 'accept-low-confidence'; // suspicion without a failed check is not a veto
  if (input.rejects >= input.cap) return 'accept-with-gap'; // the liveness/budget ceiling still holds
  if (input.rejects === 0) return 'veto';
  if (!input.progressed) return input.escalated ? 'accept-with-gap' : 'escalate'; // re-attested without working the plan
  return 'veto';
}

/**
 * R160: the reject cap in force right now. With a live deadline and at least `minRemaining` of the wall budget
 * left, the larger budgeted cap applies (the judge keeps vetoing while there is time to act on its plan); once
 * the budget is below that fraction — or there is no deadline — the liveness cap (`maxRejects`) applies. A
 * budgeted cap of 0 or one not above `maxRejects` leaves behavior byte-identical to the liveness cap.
 */
export function effectiveMaxRejects(cfg: EndTurnResolverConfig, remainingFrac: number | null, minRemaining: number): number {
  if (remainingFrac === null || !(minRemaining > 0)) return cfg.maxRejects;
  if (cfg.maxRejectsBudgeted <= cfg.maxRejects) return cfg.maxRejects;
  return remainingFrac >= minRemaining ? cfg.maxRejectsBudgeted : cfg.maxRejects;
}

/** R160: escalation line appended to the GAP fix plan from the second veto on. */
export function budgetedVetoEscalation(rejectIndex: number, cap: number, remainingMs: number, deadlineMs: number): string {
  if (rejectIndex < 2 || !(deadlineMs > 0)) return '';
  const h = Math.floor(remainingMs / 3600000); const m = Math.round((remainingMs % 3600000) / 60000);
  const left = h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
  return (
    `\n\nThis is veto ${rejectIndex} of ${cap}. About ${left} of the wall budget remains — that time is for closing the gap above, ` +
    `not for re-describing the work. Work it with tools until the task's own criterion is met, or, if it genuinely cannot be met in ` +
    `this box, name the hard limit under open_items and finish.`
  );
}

/** R167: hold the finish for one informed confirmation? Only after an accept-with-gap / accept-low-confidence verdict —
 *  or (R168) after a MEETS that no passing check backs, when `meets` is passed and meetsConfirm is on. The two share
 *  `confirmsUsed` / `finishConfirmMax`, so a session is never held twice. */
export function shouldFinishConfirm(input: {
  action: VetoAction; remainingFrac: number | null; confirmsUsed: number;
  cfg: Pick<EndTurnResolverConfig, 'finishConfirm' | 'finishConfirmMinRemaining' | 'finishConfirmMax'> & Partial<Pick<EndTurnResolverConfig, 'meetsConfirm' | 'meetsConfirmMinRemaining'>>;
  /** R168: the verdict was a genuine MEETS (not blank/retire). */
  meets?: boolean;
  /** R168: a judge-named check the harness ran just now PASSED, or the workspace's own check entry point passed. */
  evidencePassed?: boolean;
}): boolean {
  if (input.confirmsUsed >= input.cfg.finishConfirmMax) return false;
  if (input.remainingFrac === null) return false; // no deadline → nothing to confirm against
  if (input.action === 'accept' && input.meets) {
    if (!input.cfg.meetsConfirm) return false;
    if (input.evidencePassed) return false; // a verified MEETS stands
    return input.remainingFrac >= (input.cfg.meetsConfirmMinRemaining ?? 0.5);
  }
  if (!input.cfg.finishConfirm) return false;
  if (input.action !== 'accept-with-gap' && input.action !== 'accept-low-confidence') return false;
  return input.remainingFrac >= input.cfg.finishConfirmMinRemaining;
}

/** R168: the hold the junior sees in place of an unverified MEETS — what was (not) checked, the budget, its own open items. */
export function buildMeetsConfirmMessage(input: {
  remainingFrac: number; remainingMs: number; checksNamed: number; checkResults: string; openItems: unknown;
}): string {
  const mins = Math.max(0, Math.round(input.remainingMs / 60000));
  const h = mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : `${mins} min`;
  const pct = Math.round(input.remainingFrac * 100);
  const items = Array.isArray(input.openItems) ? input.openItems.map((x) => String(x)).filter(Boolean) : (input.openItems ? [String(input.openItems)] : []);
  const own = items.length ? `\n\nYOUR OWN OPEN ITEMS (from your attestation):\n- ${items.slice(0, 6).map((x) => x.slice(0, 300)).join('\n- ')}` : '';
  const why = input.checksNamed === 0
    ? 'The reviewer saw no gap but named NO command that proves the task\'s criteria, so nothing has been verified.'
    : `The reviewer saw no gap, but none of the ${input.checksNamed} proving check(s) it named PASSED when the harness ran them just now:`;
  const results = input.checkResults.trim() ? `\n\n${input.checkResults.trim().slice(0, 3000)}` : '';
  return (
    `EndTurn NOT YET ACCEPTED — the finish is UNVERIFIED. ${why}${results}\n\nFinishing ends the task and it is graded as-is; ` +
    `you cannot correct anything afterwards. You have ~${h} of the wall budget left (${pct}%).` + own +
    `\n\nBefore finishing: re-read the TASK's own acceptance criteria (the exact artifact, output, format, path or threshold it names), ` +
    `verify each one with a command you actually run, fix whatever that reveals, then call EndTurn again and it will stand.`
  );
}

/** R167: the confirmation the junior sees in place of the accepted EndTurn — budget, the reviewer's gaps, its own open items. */
export function buildFinishConfirmMessage(input: {
  remainingFrac: number; remainingMs: number; gapPlan: string; openItems: unknown; confidence?: string;
}): string {
  const mins = Math.max(0, Math.round(input.remainingMs / 60000));
  const h = mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : `${mins} min`;
  const pct = Math.round(input.remainingFrac * 100);
  const items = Array.isArray(input.openItems) ? input.openItems.map((x) => String(x)).filter(Boolean) : (input.openItems ? [String(input.openItems)] : []);
  const own = items.length ? `\n\nYOUR OWN OPEN ITEMS (from your attestation):\n- ${items.slice(0, 6).map((x) => x.slice(0, 300)).join('\n- ')}` : '';
  const gap = input.gapPlan.trim() ? `\n\nREVIEWER'S NOTES (${input.confidence ?? 'medium'} confidence; advisory, not verified):\n${input.gapPlan.trim().slice(0, 2500)}` : '';
  return (
    `EndTurn NOT YET ACCEPTED — confirm before finishing. Finishing now ends the task and it will be graded as-is; you cannot ` +
    `correct anything afterwards. You have ~${h} of the wall budget left (${pct}%).` + gap + own +
    `\n\nIf every requirement in the TASK's own words is verified by a command you actually ran, call EndTurn again and it will ` +
    `stand. Otherwise continue: pick the most valuable open item, work it with tools, verify against the task's criteria, then finish.`
  );
}
