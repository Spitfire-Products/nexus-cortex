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
