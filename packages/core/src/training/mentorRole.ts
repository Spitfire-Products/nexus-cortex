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
    timeoutMs: inputs.timeoutMs && inputs.timeoutMs > 0 ? inputs.timeoutMs : DEFAULT_TIMEOUT_MS,
    ...(temperature !== undefined ? { temperature } : {}),
    thinkingSource,
  };
}

/** The wire-level summary banked on every mentor event: what the request actually carried. */
export function describeMentorWire(cfg: MentorRoleConfig): { model: string; thinking: boolean; effort: string; budget: number } {
  return { model: cfg.modelId, thinking: cfg.thinking, effort: cfg.thinking ? cfg.effort : 'none', budget: cfg.outputBudgetTokens };
}

/** What the adapters read off a cloned model config for a mentor call. */
export interface MentorWireHint {
  thinking: boolean;
  effort: MentorEffort;
  temperature?: number;
  surface: MentorSurface;
}

export function mentorWireHint(cfg: MentorRoleConfig): MentorWireHint {
  return { thinking: cfg.thinking, effort: cfg.effort, surface: cfg.surface, ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}) };
}
