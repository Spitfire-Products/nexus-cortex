/**
 * mentorRole — the MENTOR role as a first-class, resolved config (2026-09-10, operator design).
 *
 * The harness has two model roles besides the primary:
 *   - HELPER  (HELPER_MODEL_ID): compaction, summaries, error guidance, vision hand-off — cheap, thinking OFF.
 *   - MENTOR  (MENTORSHIP_HELPER_MODEL): the lift planner, the EndTurn resolver, the deadline exit planner, the
 *     loop-exit planner and the AskForAdvice consult — bounded single-shot judgments that WANT reasoning.
 * Until 4.103.0 the mentor surfaces borrowed the main card through the helper adapter, which applied helper-role
 * assumptions (thinking disabled) — "mentor @max" never reached the wire (HB-MENTOR-THINKING). This module makes the
 * role explicit: one resolved config per surface, carried on the request as `mentorRole`, read by the adapters
 * instead of inferred, and banked on every mentor event so a ledger can prove what the wire carried.
 *
 * Pure: reads only the env it is given. Per-surface effort / budget / timeout keep their existing env variables
 * (CORTEX_LIFT_PLAN_*, CORTEX_ENDTURN_RESOLVER_*, CORTEX_DEADLINE_EXIT_MENTOR_*, CORTEX_LOOP_TOOL_BLOCK_*) — the
 * callers pass what their resolvers computed; this module adds the role-level decisions (model, thinking, temperature).
 */

export type MentorSurface =
  | 'lift-plan'
  | 'endturn-resolver'
  | 'deadline-exit-mentor'
  | 'loop-exit-planner'
  | 'mentor-consult';

export type MentorEffort = 'low' | 'medium' | 'high' | 'max';

export interface MentorRoleConfig {
  surface: MentorSurface;
  /** The mentor model (MENTORSHIP_HELPER_MODEL; caller override wins). */
  modelId: string;
  /** Whether this call sends its effort on the wire (thinking ON) or runs thinking-OFF like a helper call. */
  thinking: boolean;
  /** Effort sent when `thinking` (per-surface *_EFFORT, default max). */
  effort: MentorEffort;
  outputBudgetTokens: number;
  timeoutMs: number;
  /** Optional sampling temperature for mentor calls (CORTEX_MENTOR_TEMPERATURE); undefined = adapter default. */
  temperature?: number;
  /** Where the thinking decision came from (for the effective-config report / events). */
  thinkingSource: 'CORTEX_MENTOR_REASONING' | 'CORTEX_MENTOR_CONSULT_REASONING' | 'code-default';
  /** Thinking-on only: the budget for the FIRST (thinking-on) request; the remainder of `timeoutMs` is kept for the
   *  thinking-off retry so a slow thinking call can never starve the rescue (cell-m-r1: pro@high ran to the 90 s
   *  surface timeout and banked `none` because the retry never got a turn). */
  firstCallTimeoutMs?: number;
}

export interface MentorSurfaceInputs {
  modelId?: string;
  effort?: string;
  outputBudgetTokens?: number;
  timeoutMs?: number;
}

const DEFAULT_EFFORT: MentorEffort = 'max';
const DEFAULT_BUDGET = 4000;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_CONSULT_BUDGET = 400;
export const DEFAULT_MENTOR_MODEL = 'deepseek-flash';

function offValue(v: string | undefined): boolean {
  const s = (v ?? '').trim().toLowerCase();
  return s === 'none' || s === 'off' || s === 'false';
}

/** The per-surface effort variable each surface already honours (explicit wins over the global lever). */
export const SURFACE_EFFORT_VAR: Record<MentorSurface, string | null> = {
  'lift-plan': 'CORTEX_LIFT_PLAN_EFFORT',
  'endturn-resolver': 'CORTEX_ENDTURN_RESOLVER_EFFORT',
  'deadline-exit-mentor': 'CORTEX_DEADLINE_EXIT_MENTOR_EFFORT',
  'loop-exit-planner': 'CORTEX_LOOP_TOOL_BLOCK_EFFORT',
  'mentor-consult': null,
};

function normEffort(v: string | undefined, d: MentorEffort): MentorEffort {
  const s = (v ?? '').trim().toLowerCase();
  return s === 'low' || s === 'medium' || s === 'high' || s === 'max' ? s : d;
}

/**
 * Resolve the mentor role for one surface.
 * - planner surfaces (lift / resolver / deadline / loop-exit): thinking follows CORTEX_MENTOR_REASONING (on|none, default on).
 * - mentor-consult: thinking follows CORTEX_MENTOR_CONSULT_REASONING (default none — the 08-30 measurement: thinking-on
 *   hints came back blank under the small consult budget).
 */
export function resolveMentorRoleConfig(
  surface: MentorSurface,
  env: NodeJS.ProcessEnv = process.env,
  inputs: MentorSurfaceInputs = {},
): MentorRoleConfig {
  const isConsult = surface === 'mentor-consult';
  let thinking: boolean;
  let thinkingSource: MentorRoleConfig['thinkingSource'];
  if (isConsult) {
    const raw = env.CORTEX_MENTOR_CONSULT_REASONING;
    thinking = raw === undefined || raw.trim() === '' ? false : !offValue(raw);
    thinkingSource = raw === undefined || raw.trim() === '' ? 'code-default' : 'CORTEX_MENTOR_CONSULT_REASONING';
  } else {
    const raw = env.CORTEX_MENTOR_REASONING;
    thinking = raw === undefined || raw.trim() === '' ? true : !offValue(raw);
    thinkingSource = raw === undefined || raw.trim() === '' ? 'code-default' : 'CORTEX_MENTOR_REASONING';
  }
  const t = parseFloat((env.CORTEX_MENTOR_TEMPERATURE ?? '').trim());
  const temperature = Number.isFinite(t) && t >= 0 && t <= 2 ? t : undefined;
  const baseTimeout = inputs.timeoutMs && inputs.timeoutMs > 0 ? inputs.timeoutMs : DEFAULT_TIMEOUT_MS;
  const effortResolved = (() => {
    const sv = SURFACE_EFFORT_VAR[surface];
    const perSurface = sv ? (env[sv] ?? '').trim() : '';
    if (perSurface) return normEffort(perSurface, DEFAULT_EFFORT);
    const global = (env.CORTEX_MENTOR_EFFORT ?? '').trim();
    if (global) return normEffort(global, DEFAULT_EFFORT);
    return normEffort(inputs.effort, DEFAULT_EFFORT);
  })();
  const timeoutMs = thinking ? Math.max(baseTimeout, thinkingTimeoutMs(effortResolved, env)) : baseTimeout;
  return {
    surface,
    modelId: (inputs.modelId ?? '').trim() || (env.MENTORSHIP_HELPER_MODEL ?? '').trim() || DEFAULT_MENTOR_MODEL,
    thinking,
    // Effort precedence: the surface's own *_EFFORT (explicitly set) > CORTEX_MENTOR_EFFORT (one lever for every
    // planner surface — the low/high/max A/B) > what the surface resolver passed (its code default, max) > max.
    effort: (() => {
      const sv = SURFACE_EFFORT_VAR[surface];
      const perSurface = sv ? (env[sv] ?? '').trim() : '';
      if (perSurface) return normEffort(perSurface, DEFAULT_EFFORT);
      const global = (env.CORTEX_MENTOR_EFFORT ?? '').trim();
      if (global) return normEffort(global, DEFAULT_EFFORT);
      return normEffort(inputs.effort, DEFAULT_EFFORT);
    })(),
    outputBudgetTokens: inputs.outputBudgetTokens && inputs.outputBudgetTokens > 0 ? inputs.outputBudgetTokens : (isConsult ? DEFAULT_CONSULT_BUDGET : DEFAULT_BUDGET),
    timeoutMs,
    ...(temperature !== undefined ? { temperature } : {}),
    thinkingSource,
    ...(thinking ? { firstCallTimeoutMs: Math.round(timeoutMs * FIRST_CALL_SHARE) } : {}),
  };
}

/**
 * HB-MENTOR-BUDGET (2026-09-10, cell-m pilot): DeepSeek counts reasoning tokens INSIDE `max_tokens` (pro@high:
 * completion_tokens 2045 = 1641 reasoning + ~400 content). A thinking-on mentor call capped at the CONTENT budget
 * (4000) therefore returned EMPTY content on every real planner prompt (0/10 pro lift plans, 1/8 resolver verdicts).
 * The wire cap for a thinking-on call is the content budget PLUS this allowance; CORTEX_MENTOR_REASONING_ALLOWANCE
 * (integer tokens) overrides the per-effort table.
 */
export const REASONING_ALLOWANCE_TOKENS: Record<MentorEffort, number> = { low: 4000, medium: 8000, high: 12000, max: 24000 };

/**
 * Thinking-aware surface timeout (2026-09-10, cell-m-r1): a thinking-on mentor call reasons for 40–90+ s on real planner
 * prompts (pro@high, flash@max), so the 90 s surface timeouts that fit thinking-off calls (5–10 s) truncate it and the
 * thinking-off retry never runs. A thinking-on call gets max(surface timeout, this per-effort budget);
 * CORTEX_MENTOR_THINKING_TIMEOUT_MS (integer ms) overrides the table. Thinking-off calls keep the surface timeout.
 */
export const THINKING_TIMEOUT_MS: Record<MentorEffort, number> = { low: 120_000, medium: 180_000, high: 240_000, max: 300_000 };
/** Share of the thinking-on budget given to the first request; the rest is reserved for the thinking-off retry. */
export const FIRST_CALL_SHARE = 0.6;

export function thinkingTimeoutMs(effort: string | undefined, env: NodeJS.ProcessEnv = process.env): number {
  const o = parseInt((env.CORTEX_MENTOR_THINKING_TIMEOUT_MS ?? '').trim(), 10);
  if (Number.isInteger(o) && o > 0) return o;
  return THINKING_TIMEOUT_MS[normEffort(effort, DEFAULT_EFFORT)];
}

/** The surface timeout the orchestrator should race a mentor call against: thinking-aware. */
export function mentorSurfaceTimeoutMs(surface: MentorSurface, baseMs: number, env: NodeJS.ProcessEnv = process.env): number {
  return resolveMentorRoleConfig(surface, env, { timeoutMs: baseMs }).timeoutMs;
}

export function reasoningAllowanceTokens(effort: string | undefined, env: NodeJS.ProcessEnv = process.env): number {
  const o = parseInt((env.CORTEX_MENTOR_REASONING_ALLOWANCE ?? '').trim(), 10);
  if (Number.isInteger(o) && o >= 0) return o;
  return REASONING_ALLOWANCE_TOKENS[normEffort(effort, DEFAULT_EFFORT)];
}

/** The wire-level summary banked on every mentor event: what the request actually carried. */
export function describeMentorWire(cfg: MentorRoleConfig): { model: string; thinking: boolean; effort: string; budget: number } {
  return { model: cfg.modelId, thinking: cfg.thinking, effort: cfg.thinking ? cfg.effort : 'none', budget: cfg.outputBudgetTokens };
}

/**
 * DELIVERY (2026-09-10, operator): a mentor event must say WHO delivered the text the model saw, so a thinking-off
 * rescue (HB-MENTOR-BUDGET retry) is never mistaken for a thinking-on success in the transcripts/decisions:
 *   thinking-on         — the thinking-on request itself returned content
 *   thinking-off        — a thinking-off (CORTEX_MENTOR_REASONING=none / consult) request returned content
 *   thinking-off-retry  — the thinking-on request came back EMPTY; the one thinking-off retry delivered
 *   none                — nothing usable was delivered (empty after retry, timeout, error, call still in flight)
 * `thinking`/`effort` on the event keep meaning the REQUESTED wire config; `deliveredThinking`/`deliveredEffort` say what
 * actually produced the content. Adjudicate mentor efficacy on `deliveredBy`, never on `thinking`.
 */
export type MentorDelivery = 'thinking-on' | 'thinking-off' | 'thinking-off-retry' | 'none';

export interface MentorCallMeta {
  finishReason?: string;
  contentChars: number;
  reasoningTokens?: number;
  completionTokens?: number;
  maxTokensSent: number;
  thinking: boolean;
  truncated: boolean;
  retriedThinkingOff: boolean;
  retryMaxTokensSent?: number;
  /** the thinking-on request was aborted at firstCallTimeoutMs (before it returned) */
  abortedFirstCall?: boolean;
  firstCallTimeoutMs?: number;
}

export interface MentorWireWithDelivery {
  model: string; thinking: boolean; effort: string; budget: number;
  deliveredBy: MentorDelivery;
  deliveredThinking: boolean;
  deliveredEffort: string;
  finishReason?: string; contentChars?: number; reasoningTokens?: number; completionTokens?: number;
  maxTokensSent?: number; truncated?: boolean; retriedThinkingOff?: boolean; retryMaxTokensSent?: number;
  abortedFirstCall?: boolean; firstCallTimeoutMs?: number;
}

export function describeMentorDelivery(
  wire: { model: string; thinking: boolean; effort: string; budget: number },
  meta?: MentorCallMeta | null,
): MentorWireWithDelivery {
  if (!meta) return { ...wire, deliveredBy: 'none', deliveredThinking: false, deliveredEffort: 'none' };
  const delivered = (meta.contentChars ?? 0) > 0;
  let deliveredBy: MentorDelivery;
  if (!delivered) deliveredBy = 'none';
  else if (meta.retriedThinkingOff) deliveredBy = 'thinking-off-retry';
  else if (meta.thinking) deliveredBy = 'thinking-on';
  else deliveredBy = 'thinking-off';
  const deliveredThinking = deliveredBy === 'thinking-on';
  return {
    ...wire,
    deliveredBy,
    deliveredThinking,
    deliveredEffort: deliveredThinking ? wire.effort : 'none',
    finishReason: meta.finishReason, contentChars: meta.contentChars, reasoningTokens: meta.reasoningTokens,
    completionTokens: meta.completionTokens, maxTokensSent: meta.maxTokensSent, truncated: meta.truncated,
    retriedThinkingOff: meta.retriedThinkingOff, retryMaxTokensSent: meta.retryMaxTokensSent,
    abortedFirstCall: meta.abortedFirstCall, firstCallTimeoutMs: meta.firstCallTimeoutMs,
  };
}

/** What the adapters read off a cloned model config for a mentor call. */
export interface MentorWireHint {
  thinking: boolean;
  effort: MentorEffort;
  temperature?: number;
  surface: MentorSurface;
  /** thinking-on only: abort the first request at this budget so the thinking-off retry fits the surface timeout */
  firstCallTimeoutMs?: number;
}

export function mentorWireHint(cfg: MentorRoleConfig): MentorWireHint {
  return {
    thinking: cfg.thinking, effort: cfg.effort, surface: cfg.surface,
    ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
    ...(cfg.thinking && cfg.firstCallTimeoutMs ? { firstCallTimeoutMs: cfg.firstCallTimeoutMs } : {}),
  };
}
