/**
 * Hard plan-gate for launching `autoresearch-agent` subagents. The PM MUST produce an
 * experiment plan BEFORE any auto-research subagent is spawned — the live run that flailed
 * (5 agents, 0 fixes, 2 timeouts) proved the soft hint alone isn't enough. Enforced inside
 * TaskTool so the launch is rejected before a subagent is ever forked.
 *
 * Context-switched by how the harness is being accessed:
 *   - Interactive TUI (a TTY): require the plan was drafted + presented in PLAN MODE
 *     (EnterPlanMode → ExitPlanMode marks the signal here; the user approves it via the UI).
 *   - Headless CLI / server (no TTY): require a TODO planning checklist exists (TodoCreate).
 *
 * Scope: this enforces that a plan EXISTS, not that its metric is valid — the semantic
 * quality (is the metric measurable/sound?) stays with the steering hint + the agent's
 * fail-fast rule.
 */
import { getCurrentTodos } from '../implementations/ui/TodoWriteTool.js';

let planModeUsedAt = 0;

/** Called by ExitPlanModeTool when the PM presents a plan — satisfies the interactive gate. */
export function markAutoResearchPlanMode(): void {
  planModeUsedAt = Date.now();
}

/** Reset hook (tests / new session). */
export function resetAutoResearchPlanGate(): void {
  planModeUsedAt = 0;
}

/** Interactive terminal (TUI) vs headless (CLI/server). */
function isInteractive(): boolean {
  return !!(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Returns a rejection message when an `autoresearch-agent` launch must be blocked for lack
 * of a plan, or null when the launch is allowed (or the feature is off / not this agent).
 */
export function checkAutoResearchPlanGate(subagentType: string): string | null {
  if (subagentType !== 'autoresearch-agent') return null;
  const mode = (process.env.AUTORESEARCH_AGENTS ?? 'off').trim().toLowerCase();
  if (mode !== 'native' && mode !== 'mcp') return null; // feature off — not gated

  if (isInteractive()) {
    if (planModeUsedAt > 0) return null;
    return 'BLOCKED — plan required before launching autoresearch-agent subagents. You are the PM: in this ' +
      'interactive session, FIRST draft the experiment plan in PLAN MODE and present it for approval ' +
      '(EnterPlanMode → ExitPlanMode) — the metric + how it is measured, the pass/fail criterion, the ' +
      'base-vs-candidate control (train + holdout), the per-subagent variation, and the continue/fail rules. ' +
      'Once the plan is approved, launch the agents.';
  }
  const todos = getCurrentTodos();
  if (todos.length > 0) return null;
  return 'BLOCKED — plan required before launching autoresearch-agent subagents. You are the PM: headless, ' +
    'FIRST create an experiment-plan TODO checklist (TodoCreate) covering the metric + how it is measured, ' +
    'the pass/fail criterion, the base-vs-candidate control (train + holdout), the per-subagent variation, ' +
    'and the continue/fail rules. Then launch the agents.';
}
