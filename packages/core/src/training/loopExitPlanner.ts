/**
 * loopExitPlanner.ts — the mentor-as-loop-exit-planner (CORTEX_LOOP_TOOL_BLOCK escalation).
 *
 * The 4th sibling of the bounded pro-max mentor family (endTurnResolver.ts, deadline-exit in
 * HelperModelMiddleware, liftPlanner.ts): when the hard loop-tool-block has fired TWICE on the same
 * tool without breaking the pattern, the escalation reroutes the stuck-loop reasoning away from the
 * narrow-door action model — which cannot see WHY it is stuck — to a bounded max-reasoning mentor
 * whose only job is REPLAN (a concrete different approach) or RETIRE (stop, submit best-effort).
 *
 * Single-shot generateGuidance like evaluateEndTurn; max reasoning is the design intent (a bounded
 * one-shot planner cannot grind) and the big output budget avoids reasoning-eats-the-answer
 * truncation on DeepSeek (the same landmine documented for the resolver/lift-planner).
 */

export interface LoopExitConfig {
  effort: string;
  outputBudgetTokens: number;
  timeoutMs: number;
}

const DEFAULTS: LoopExitConfig = { effort: 'max', outputBudgetTokens: 4000, timeoutMs: 90000 };

export function resolveLoopExitConfig(env: NodeJS.ProcessEnv = process.env): LoopExitConfig {
  const b = parseInt((env.CORTEX_LOOP_TOOL_BLOCK_BUDGET_TOKENS ?? '').trim(), 10);
  const e = (env.CORTEX_LOOP_TOOL_BLOCK_EFFORT ?? '').trim();
  const t = parseInt((env.CORTEX_LOOP_TOOL_BLOCK_TIMEOUT_MS ?? '').trim(), 10);
  return {
    effort: e || DEFAULTS.effort,
    outputBudgetTokens: Number.isInteger(b) && b > 0 ? b : DEFAULTS.outputBudgetTokens,
    timeoutMs: Number.isInteger(t) && t > 0 ? t : DEFAULTS.timeoutMs,
  };
}

export interface LoopExitContext {
  task: string;
  envReport?: string;
  loopingTool: string;
  recentAttempts?: string;
}

export const LOOP_EXIT_SYSTEM =
  'You are a senior engineer rescuing a junior agent that is STUCK in a non-converging loop in a real ' +
  'terminal container. The junior has repeated the SAME failing approach with the "{{TOOL}}" tool over and ' +
  'over; an automatic guard already blocked and redirected it TWICE and it STILL cannot break the pattern. ' +
  'It cannot see why it is stuck. You are given the original TASK, an ENVIRONMENT REPORT, the tool it keeps ' +
  'repeating, and its RECENT ATTEMPTS.\n' +
  'Answer exactly ONE question: is there a genuinely DIFFERENT path to the task\'s real requirements (the ' +
  'criteria the hidden grader will check), or is this task unclosable by this junior in this box?\n' +
  'Be adversarial about the loop: name the specific assumption or dead-end approach the junior keeps ' +
  'repeating, and give a path that does NOT repeat it (a different tool, a different command, reading the ' +
  'actual state first, installing a missing dependency, a different algorithm).\n' +
  'FORMAT — your FIRST line MUST be exactly one of:\n' +
  '  VERDICT: REPLAN\n' +
  '  VERDICT: RETIRE\n' +
  'If REPLAN: after the verdict line, give a SHORT numbered plan of concrete DIFFERENT steps — for each, the ' +
  'exact action (which tool + what) and the check that verifies it against the TASK\'s criteria. Do NOT ' +
  'restate the failing approach; do NOT rewrite the whole solution.\n' +
  'If RETIRE: use it ONLY when you are CONFIDENT no further attempt can help — a fundamentally wrong approach ' +
  'with no viable alternative, a missing capability/dependency unobtainable in this box, or an impossible / ' +
  'self-contradictory requirement. After the verdict line give ONE short line naming why it is unclosable, ' +
  'then tell the junior to record its best-effort state in open_items and STOP. 🔴 When in doubt between ' +
  'REPLAN and RETIRE, choose REPLAN — only RETIRE when more attempts genuinely cannot help.';

export function buildLoopExitPrompt(ctx: LoopExitContext): string {
  const parts = [
    `TASK:\n${ctx.task}`,
    ctx.envReport ? `\nENVIRONMENT REPORT:\n${ctx.envReport}` : '',
    `\nLOOPING TOOL (blocked twice): ${ctx.loopingTool}`,
    ctx.recentAttempts ? `\nRECENT ATTEMPTS (what the junior kept doing):\n${ctx.recentAttempts}` : '',
    '\nGive your verdict now.',
  ];
  return parts.filter(Boolean).join('\n');
}

/** Light verdict tag for the decision-store event (REPLAN | RETIRE | UNKNOWN). Delivery uses the full text. */
export function parseLoopExitVerdict(text: string): 'REPLAN' | 'RETIRE' | 'UNKNOWN' {
  const m = /^\s*VERDICT:\s*(REPLAN|RETIRE)\b/im.exec(text ?? '');
  return m && m[1] ? (m[1].toUpperCase() as 'REPLAN' | 'RETIRE') : 'UNKNOWN';
}
