/**
 * Transport reasoning-effort fixes (2026-10-02; stack-portability map
 * .cortex/research/stack-portability-2026-10-02.md, note N1). Each is DARK behind its own env flag; with the flag off
 * every caller takes its pre-existing code path unchanged (byte-identical requests).
 *
 * - CORTEX_OPENAI_TOOLS_REASONING: the gateway forwards the request/action effort for OpenAI reasoning cards even though they
 *   do not declare `reasoning.toggleable`, so CORTEX_ACTION_EFFORT reaches `reasoning.effort` on the RESPONSES API. Chat/completions
 *   is unchanged: R19b's drop stays because OpenAI still rejects reasoning_effort + function tools there (live probe 2026-10-03:
 *   gpt-5.4-nano + gpt-5.6-luna → 400 "use /v1/responses"); Responses accepts it with tools (200 on both).
 * - CORTEX_ANTHROPIC_EFFORT: Anthropic adaptive-thinking families (claude-4.7 / 4.8 / claude-5 / claude-fable-5) got
 *   `thinking:{type:'adaptive'}` only, so the action effort never reached the wire. On: `output_config.effort` = the
 *   effort (low|medium|high|xhigh|max; GA, no beta header). Non-adaptive families: `max` was not in the budget map and
 *   fell to 10000; on, `max` maps to a large budget clamped below max_tokens (budget_tokens must be < max_tokens, >= 1024).
 * - CORTEX_GEMINI_TOOLS_THINKING: Gemini thinkingConfig was never sent with tools (the @google/genai builders skipped
 *   it — "cannot coexist", a Gemini 2.0-era observation) and the REST builder only ever sent a card-level thinkingLevel.
 *   On: the action effort maps to generationConfig.thinkingConfig — `thinkingLevel` on Gemini 3.x, `thinkingBudget` on
 *   2.5 and older — on REST and SDK, with or without tools.
 *
 * Pure helpers — no client state. Flags are resolved per call so tests/benches can flip them.
 */

function flagOn(raw: string | undefined): boolean {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1';
}

export function isOpenAIToolsReasoningEnabled(): boolean {
  return flagOn(process.env.CORTEX_OPENAI_TOOLS_REASONING);
}
export function isAnthropicEffortEnabled(): boolean {
  return flagOn(process.env.CORTEX_ANTHROPIC_EFFORT);
}
export function isGeminiToolsThinkingEnabled(): boolean {
  return flagOn(process.env.CORTEX_GEMINI_TOOLS_THINKING);
}

// ---------------------------------------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------------------------------------

const ANTHROPIC_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/**
 * `output_config.effort` value for an adaptive-thinking family, or undefined (send nothing → provider default).
 * 'none' / unknown values send nothing (adaptive families have no "off" effort).
 */
export function anthropicOutputEffort(reasoningEffort: string | undefined): string | undefined {
  const e = String(reasoningEffort ?? '').trim().toLowerCase();
  return ANTHROPIC_EFFORT_LEVELS.has(e) ? e : undefined;
}

/** Target thinking budget for effort `max` on budget_tokens families (before the max_tokens clamp). */
export const ANTHROPIC_MAX_EFFORT_BUDGET = 120000;
/** Visible-output room kept below max_tokens when clamping the `max` budget. */
export const ANTHROPIC_MAX_EFFORT_OUTPUT_ROOM = 1024;

/**
 * budget_tokens for effort `max` on a non-adaptive family: ANTHROPIC_MAX_EFFORT_BUDGET clamped to
 * max_tokens - ANTHROPIC_MAX_EFFORT_OUTPUT_ROOM (the API requires budget_tokens < max_tokens and >= 1024).
 * Returns undefined when max_tokens is too small to honour the floor — the caller keeps its legacy value.
 */
export function anthropicMaxEffortBudget(maxTokens: number | undefined): number | undefined {
  const mt = Number(maxTokens);
  if (!Number.isFinite(mt) || mt <= 0) return undefined;
  const b = Math.min(ANTHROPIC_MAX_EFFORT_BUDGET, Math.floor(mt) - ANTHROPIC_MAX_EFFORT_OUTPUT_ROOM);
  return b >= 1024 ? b : undefined;
}

// ---------------------------------------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------------------------------------

/** Gemini 3.x takes `thinkingLevel`; 2.5 and older take `thinkingBudget` (sending both is a 400). */
export function isGeminiThinkingLevelModel(modelId: string): boolean {
  return /^(models\/)?gemini-([3-9]|\d{2,})/i.test(String(modelId ?? '').trim());
}

/** thinkingBudget per effort for Gemini 2.5 (Flash range 0-24576; Pro 128-32768 — every value here is valid on both). */
export const GEMINI_BUDGET_BY_EFFORT: Record<string, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 24576,
  max: 24576,
};

/** thinkingLevel per effort for Gemini 3.x (levels low|medium|high; xhigh/max clamp to high). */
export const GEMINI_LEVEL_BY_EFFORT: Record<string, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'high',
  max: 'high',
};

/**
 * The generationConfig.thinkingConfig for an effort, or undefined (none / unknown effort → send nothing, API default).
 */
export function geminiThinkingConfigForEffort(
  modelId: string,
  reasoningEffort: string | undefined,
): { thinkingLevel: string } | { thinkingBudget: number } | undefined {
  const e = String(reasoningEffort ?? '').trim().toLowerCase();
  if (isGeminiThinkingLevelModel(modelId)) {
    const level = GEMINI_LEVEL_BY_EFFORT[e];
    return level ? { thinkingLevel: level } : undefined;
  }
  const budget = GEMINI_BUDGET_BY_EFFORT[e];
  return budget !== undefined ? { thinkingBudget: budget } : undefined;
}

// ---------------------------------------------------------------------------------------------------------
// CORTEX_ACTION_EFFORT_FIRST — request 0 of each user turn
// ---------------------------------------------------------------------------------------------------------

/**
 * CORTEX_ACTION_EFFORT is filled into the request params AFTER the first request of each user turn is built
 * (CortexOrchestrator initialPrepOpts vs the `??=` in the loop setup), so request 0 ran at the card default and
 * requests 1+ at the action effort. On DeepSeek that is harmless (card 'medium' is coerced to 'high' server-side and
 * the anchor-lift bust lands on the same boundary); on other providers it sends a different effort on request 0 and
 * costs one extra cache break per user turn. DARK: CORTEX_ACTION_EFFORT_FIRST=on → request 0 gets the action effort
 * when no ramp / request param set one. Off → undefined (byte-identical).
 */
export function firstRequestActionEffort(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!flagOn(env.CORTEX_ACTION_EFFORT_FIRST)) return undefined;
  const e = String(env.CORTEX_ACTION_EFFORT ?? '').trim();
  return e || undefined;
}
