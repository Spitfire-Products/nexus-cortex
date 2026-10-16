/**
 * R260 HB-ACCEPT-GATE (2026-10-16) — an INDEPENDENT typed decision model closes the resolver's accept.
 *
 * The EndTurn resolver's hold cycles correlate with passing; its accept LABEL does not (accept precision 0.52–0.59 across t4in/rsa, false
 * accepts of one kind: the judge grades its own prior checklist). On 262 sessions "judge accept AND Jev P(done) >= 0.3" raised accept
 * precision 0.35 → 0.44. This module asks the typed model (hosted Jev or a self-hosted System-One-compatible server such as Amos) the
 * bake-off's `done` + `verified` questions over GATE-INDEPENDENT evidence (never the verdict, plan, confidence or veto history — E0 showed the
 * judge's opinion in the state collapses the AND to the judge) and, in `gate` mode, turns an accept-class action into ONE more hold when
 * P(done) is below the floor. `shadow` banks the probability without touching the decision. Default off = byte-identical.
 */
import { jevNoul, type JevNoulQuestion, type JevGateResult } from './jevGate.js';

export type AcceptGateMode = 'off' | 'shadow' | 'gate';
export type DecisionModel = 'jev' | 'amos';

export interface AcceptGateConfig {
  mode: AcceptGateMode;
  /** P(done) floor below which a gate-mode accept becomes a hold (Jev 0.30; amos-large ~0.35 raw — fit per model on the sibling grades). */
  min: number;
  /** Holds per session (default 2); never below the resolver's veto floor. */
  max: number;
  model: DecisionModel;
  /** Self-hosted System One endpoint (amos `/v1/systemone`); unused for `jev` (TYPESAFE_API_URL / default). */
  url: string;
  timeoutMs: number;
}

export const ACCEPT_GATE_DEFAULTS: AcceptGateConfig = { mode: 'off', min: 0.3, max: 2, model: 'jev', url: '', timeoutMs: 8000 };

/** The bake-off's questions, verbatim (jev-eval-done.py / questions.json), so the 256-state numbers transfer. */
export const ACCEPT_GATE_QUESTIONS: Record<string, JevNoulQuestion> = {
  done: { type: 'noul', instructions: 'Judging only from the evidence in the state, is the task described in task_instruction fully and correctly completed, such that an independent hidden test suite written from the instruction would pass?' },
  verified: { type: 'noul', instructions: "Did the agent run the task's own tests or an equivalent verification command and observe it passing in recent_tool_calls?" },
};

export function resolveAcceptGateConfig(env: NodeJS.ProcessEnv = process.env): AcceptGateConfig {
  const m = (env.CORTEX_JUDGE_ACCEPT_GATE ?? '').trim().toLowerCase();
  const mode: AcceptGateMode = m === 'gate' ? 'gate' : m === 'shadow' ? 'shadow' : 'off';
  const min = parseFloat((env.CORTEX_JUDGE_ACCEPT_GATE_MIN ?? '').trim());
  const max = parseInt((env.CORTEX_JUDGE_ACCEPT_GATE_MAX ?? '').trim(), 10);
  const dm = (env.CORTEX_DECISION_MODEL ?? '').trim().toLowerCase();
  const url = (env.CORTEX_DECISION_URL ?? '').trim();
  const t = parseInt((env.CORTEX_JUDGE_ACCEPT_GATE_TIMEOUT_MS ?? '').trim(), 10);
  return {
    mode,
    min: Number.isFinite(min) && min > 0 && min < 1 ? min : ACCEPT_GATE_DEFAULTS.min,
    max: Number.isInteger(max) && max >= 0 ? Math.min(6, max) : ACCEPT_GATE_DEFAULTS.max,
    model: dm === 'amos' ? 'amos' : 'jev',
    url,
    timeoutMs: Number.isInteger(t) && t >= 1000 ? Math.min(60_000, t) : ACCEPT_GATE_DEFAULTS.timeoutMs,
  };
}

const ACCEPT_CLASS = new Set(['accept', 'accept-with-gap', 'accept-low-confidence']);
export function isAcceptClass(action: string): boolean { return ACCEPT_CLASS.has(action); }

/** Keys that must NEVER appear in the gate's state (gate independence, E0 2026-09-21). */
export const ACCEPT_GATE_FORBIDDEN_KEYS = ['verdict', 'plan', 'confidence', 'rejects', 'reviewer_open_items', 'prior_vetoes_this_task', 'action'] as const;

export interface AcceptGateStateInput {
  task: string;
  workspaceDelta: string;
  /** The resolver's own harness-run CHECK outputs (real evidence, not opinion). */
  checkOutput: string;
  finalMessage: string;
  toolResults: Array<{ tool_name: string; content?: unknown; is_error?: boolean }>;
  remainingFrac: number | null;
}

/** The same shape as the 256-state eval (jev-eval-done.py: task, final message, recent tool calls with outputs, workspace evidence). */
export function buildAcceptGateState(input: AcceptGateStateInput): Record<string, unknown> {
  const calls = input.toolResults.slice(-8).map((t) => ({
    tool: t.tool_name,
    error: !!t.is_error,
    output: (typeof t.content === 'string' ? t.content : JSON.stringify(t.content ?? '')).slice(0, 1500),
  }));
  return {
    task_instruction: (input.task || '').slice(0, 7000),
    final_message: (input.finalMessage || '').slice(0, 4000),
    recent_tool_calls: calls,
    workspace_delta: (input.workspaceDelta || '').slice(0, 6000),
    harness_check_output: (input.checkOutput || '').slice(0, 3000),
    remaining_budget_fraction: input.remainingFrac === null ? null : Number(input.remainingFrac.toFixed(3)),
  };
}

export interface AcceptGateDecision { held: boolean; reason: string }

/** Pure: shadow never holds; gate holds only when P(done) is known and below the floor, within the per-session cap and above the budget floor. */
export function decideAcceptGate(a: { mode: AcceptGateMode; action: string; pDone: number | null; min: number; holdsUsed: number; max: number; remainingFrac: number | null; minRemaining: number }): AcceptGateDecision {
  if (a.mode !== 'gate') return { held: false, reason: a.mode === 'shadow' ? 'shadow' : 'off' };
  if (!isAcceptClass(a.action)) return { held: false, reason: 'not-accept-class' };
  if (a.pDone === null || !Number.isFinite(a.pDone)) return { held: false, reason: 'fail-open' };
  if (a.pDone >= a.min) return { held: false, reason: 'above-min' };
  if (a.holdsUsed >= a.max) return { held: false, reason: 'cap' };
  if (a.minRemaining > 0 && a.remainingFrac !== null && a.remainingFrac < a.minRemaining) return { held: false, reason: 'below-floor' };
  return { held: true, reason: 'below-min' };
}

export function formatAcceptGateHoldMessage(a: { pDone: number; pVerified: number | null; min: number; holdIndex: number; max: number; remainingFrac: number | null }): string {
  const rem = a.remainingFrac === null ? '' : ` ${Math.round(a.remainingFrac * 100)}% of the budget remains.`;
  const ver = a.pVerified === null ? '' : ` P(verified by running the task's own checks)=${a.pVerified.toFixed(2)}.`;
  return `Independent check before finishing (hold ${a.holdIndex}/${a.max}): a typed decision model reading only the task, your final message, the recent tool outputs and the workspace changes puts P(task fully and correctly completed)=${a.pDone.toFixed(2)}, below the ${a.min.toFixed(2)} floor.${ver}${rem}\n` +
    `Run the task's own tests or an equivalent verification command, fix what they show, and call EndTurn again with the passing output quoted. If every requirement is already met and verified, say which command proved it.`;
}

/** The typed call: hosted Jev (key) or a self-hosted System One endpoint (no key needed). Fail-open (null) on any error/timeout. */
export async function decisionNoul(state: Record<string, unknown>, questions: Record<string, JevNoulQuestion>, cfg: AcceptGateConfig,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}): Promise<JevGateResult | null> {
  if (cfg.model === 'amos') {
    if (!cfg.url) return null;
    return jevNoul(state, questions, { env: opts.env, fetchImpl: opts.fetchImpl, timeoutMs: cfg.timeoutMs, endpoint: cfg.url, keyOptional: true });
  }
  return jevNoul(state, questions, { env: opts.env, fetchImpl: opts.fetchImpl, timeoutMs: cfg.timeoutMs });
}
