/**
 * Typed empty-response classification (grok-build sampler port, 2026-08-02).
 *
 * grok-build's `EmptyResponse` carries a forensic reason — `reasoning_only`
 * (the model produced reasoning but no visible answer) vs `no_visible_content`
 * (nothing usable at all) — plus finish_reason / token counts. Our R18b/R32
 * empty-response retry previously treated every empty turn the same. This is
 * the classifier: it does not change the retry DECISION (one bounded retry,
 * as validated), it enriches the retry's log + nudge + surfaced metadata so
 * the two failure shapes are distinguishable and steered slightly differently.
 *
 * Pure — no orchestrator state.
 */

import { hasVisibleAssistantText } from './assistantTextPresence.js';

export type EmptyResponseKind =
  | 'not_empty'
  | 'reasoning_only'
  | 'reasoning_only_active'
  | 'no_visible_content'
  | 'truncated';

/** Provider stop/finish reasons that mean the output was CUT OFF by the token limit (not "done"). */
const TRUNCATION_STOP = new Set(['max_tokens', 'length', 'max_output_tokens', 'model_length']);

export interface EmptyResponseClassification {
  kind: EmptyResponseKind;
  /** The model emitted thinking/redacted_thinking blocks. */
  hadReasoning: boolean;
  /** The model emitted an (unexecuted) tool_use — not an empty turn. */
  hadToolUse: boolean;
}

function blocks(content: unknown): any[] {
  return Array.isArray(content) ? content : [];
}

/**
 * @param loopHasBudget — HB-ENDTURN-TERMINAL (2026-09-08): the tool loop still has budget/iterations
 *   left (computed by the orchestrator; gated behind CORTEX_EMPTY_TURN_CONTINUE). A reasoning-only turn
 *   that ISN'T truncated is AMBIGUOUS: "reasoned to a final answer, forgot to surface it" (exhausted →
 *   force the answer, no tools) vs "reasoned about the NEXT action mid-recon" (has budget → CONTINUE with
 *   tools). The budget-blind classifier previously routed BOTH to `reasoning_only` (write-your-answer +
 *   forbid tools), which forced premature terminal surrender on DeepSeek mid-recon builds. With budget
 *   remaining we split it into `reasoning_only_active` (continue-with-tools), mirroring the D-E `truncated`
 *   carve-out. When loopHasBudget is undefined/false the behavior is byte-identical to before.
 */
export function classifyEmptyResponse(
  content: unknown,
  stopReason?: string,
  loopHasBudget?: boolean,
): EmptyResponseClassification {
  const bs = blocks(content);
  const hadReasoning = bs.some(
    (b) => b?.type === 'thinking' || b?.type === 'redacted_thinking',
  );
  const hadToolUse = bs.some((b) => b?.type === 'tool_use');

  if (hasVisibleAssistantText(content as any) || hadToolUse) {
    return { kind: 'not_empty', hadReasoning, hadToolUse };
  }
  // D-E (2026-09-04): an empty turn that hit the OUTPUT TOKEN LIMIT mid-thought is TRUNCATED, not
  // "done reasoning". classifyEmptyResponse used to see only content-block shape, so a max_tokens
  // cutoff landed in `reasoning_only` and got the "write your complete answer now" nudge — which
  // just truncates again. The correct remedy is to CONTINUE. Takes priority over reasoning_only.
  if (stopReason && TRUNCATION_STOP.has(stopReason.trim().toLowerCase())) {
    return { kind: 'truncated', hadReasoning, hadToolUse };
  }
  if (hadReasoning) {
    // HB-ENDTURN-TERMINAL: with budget remaining this is a mid-recon reasoning turn (continue), not a
    // finished-but-unsurfaced answer. Only when budget is spent do we demand the final answer (no tools).
    return { kind: loopHasBudget ? 'reasoning_only_active' : 'reasoning_only', hadReasoning, hadToolUse };
  }
  return { kind: 'no_visible_content', hadReasoning, hadToolUse };
}

/**
 * Nudge tailored to the empty-response kind. `reasoning_only` means the model
 * did the thinking but never surfaced the answer — tell it exactly that;
 * `reasoning_only_active` (budget remaining) means it was thinking about its
 * NEXT action — tell it to continue; `no_visible_content` gets the generic
 * completion prompt.
 */
export function emptyResponseNudge(kind: EmptyResponseKind): string {
  if (kind === 'truncated') {
    return 'Your previous response was cut off by the output token limit before you finished — it was NOT complete. Continue from where you stopped and finish concisely; do not restart from the beginning.';
  }
  if (kind === 'reasoning_only_active') {
    return 'You produced reasoning but took no action and gave no final answer, and you still have budget remaining. Continue the task now — take your next concrete action (call a tool), or give your complete, verified final answer only if you are actually finished.';
  }
  if (kind === 'reasoning_only') {
    return 'You produced reasoning but no visible answer. Write out your complete final answer now, in plain text, based on that reasoning.';
  }
  return 'Your previous response had no content. Provide your complete final answer now in plain text.';
}

/** D-E: a truncated turn was cut off — it should be allowed to CONTINUE (incl. tools), not be told
 * "do not call any more tools" (which the reasoning_only/no_content path appends).
 * HB-ENDTURN-TERMINAL: `reasoning_only_active` (mid-recon, budget remaining) is likewise a CONTINUE. */
export function nudgeForbidsTools(kind: EmptyResponseKind): boolean {
  return kind !== 'truncated' && kind !== 'reasoning_only_active';
}

/**
 * R153 HB-REASONING-EXHAUSTION (2026-09-16, tb4-flash-v3): a `truncated` turn that carried reasoning and
 * nothing else spent the WHOLE output budget thinking (DeepSeek flash at effort high: 58 turns at exactly
 * 65536 output tokens across 23 of 63 sessions, 3.8M output tokens burned, sessions ending at iteration
 * 10 with 97% of the wall budget left). "Continue from where you stopped" cannot work — the reasoning is
 * not resumable — so the remedy is to think LESS on the next call(s): step the reasoning effort down one
 * level for a bounded number of continuations and say plainly what happened.
 */
export function isReasoningExhaustion(cls: EmptyResponseClassification | null | undefined): boolean {
  return !!cls && cls.kind === 'truncated' && cls.hadReasoning && !cls.hadToolUse;
}

export type ReasoningEffortLevel = 'low' | 'medium' | 'high';

/** One level down from the effective effort; unknown/card-default effort steps to 'medium' first. */
export function stepDownEffort(current: string | undefined): ReasoningEffortLevel {
  const c = (current ?? '').trim().toLowerCase();
  if (c === 'max' || c === 'high' || c === 'xhigh') return 'medium';
  if (c === 'medium') return 'low';
  if (c === 'low' || c === 'minimal' || c === 'none') return 'low';
  return 'medium';
}

export interface ReasoningExhaustBackoffConfig { enabled: boolean; turns: number }

/** CORTEX_REASONING_EXHAUST_BACKOFF (default on; 'false' disables) / CORTEX_REASONING_EXHAUST_BACKOFF_TURNS (default 2, 1..10). */
export function resolveReasoningExhaustBackoff(env: NodeJS.ProcessEnv = process.env): ReasoningExhaustBackoffConfig {
  const v = (env.CORTEX_REASONING_EXHAUST_BACKOFF ?? '').trim().toLowerCase();
  // HB-TURN-CONTRACT: the channel contract re-issues at the SAME effort — backoff defaults OFF there (explicit 'true' overrides).
  const channel = String(env.CORTEX_TURN_CONTRACT ?? '').trim().toLowerCase() === 'channel';
  const enabled = v === '' ? !channel : !(v === 'false' || v === '0' || v === 'off');
  const rawTurns = (env.CORTEX_REASONING_EXHAUST_BACKOFF_TURNS ?? '').trim();
  const n = rawTurns === '' ? 2 : Number(rawTurns);
  const turns = Number.isFinite(n) && n >= 1 ? Math.min(10, Math.floor(n)) : 2;
  return { enabled, turns };
}

export function reasoningExhaustionNudge(level: ReasoningEffortLevel | undefined, opts: { contract?: string; outputCap?: number; env?: NodeJS.ProcessEnv } = {}): string {
  const contract = opts.contract ?? String((opts.env ?? process.env).CORTEX_TURN_CONTRACT ?? '').trim().toLowerCase();
  if (contract === 'channel') {
    // HB-TURN-CONTRACT: the Terminus-2 recovery — say exactly what happened and re-issue at the SAME effort (no step-down).
    const cap = opts.outputCap && opts.outputCap > 0 ? `${opts.outputCap} tokens` : 'the maximum output length';
    return (
      `NONE of the actions you intended were performed: your reasoning consumed the entire output budget (${cap}, reasoning ` +
      'counts against it) and no answer was produced. Re-issue this turn: state ANALYSIS and PLAN in a few sentences, then ' +
      'make the tool call. Break the work into smaller steps, each well under that budget.'
    );
  }
  const lv = level ? ` Reasoning effort is temporarily lowered to '${level}' for your next calls.` : '';
  return (
    'Your previous turn spent the ENTIRE output budget on internal reasoning and delivered nothing — no text, no tool ' +
    'call — so it was wasted. Do not restart that analysis. Decide in a few sentences and ACT: call the single most ' +
    'useful tool now (a quick experiment beats a long derivation), or write your final answer only if you are actually ' +
    'done.' + lv
  );
}

/** Kind-tailored nudge that also knows the exhaustion special case (falls back to emptyResponseNudge). */
export function emptyResponseNudgeFor(cls: EmptyResponseClassification, backoffLevel?: ReasoningEffortLevel, outputCap?: number): string {
  if (isReasoningExhaustion(cls)) return reasoningExhaustionNudge(backoffLevel, { outputCap });
  return emptyResponseNudge(cls.kind);
}
