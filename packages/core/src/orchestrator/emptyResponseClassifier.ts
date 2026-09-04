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

export type EmptyResponseKind = 'not_empty' | 'reasoning_only' | 'no_visible_content' | 'truncated';

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

export function classifyEmptyResponse(content: unknown, stopReason?: string): EmptyResponseClassification {
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
  return {
    kind: hadReasoning ? 'reasoning_only' : 'no_visible_content',
    hadReasoning,
    hadToolUse,
  };
}

/**
 * Nudge tailored to the empty-response kind. `reasoning_only` means the model
 * did the thinking but never surfaced the answer — tell it exactly that;
 * `no_visible_content` gets the generic completion prompt.
 */
export function emptyResponseNudge(kind: EmptyResponseKind): string {
  if (kind === 'truncated') {
    return 'Your previous response was cut off by the output token limit before you finished — it was NOT complete. Continue from where you stopped and finish concisely; do not restart from the beginning.';
  }
  if (kind === 'reasoning_only') {
    return 'You produced reasoning but no visible answer. Write out your complete final answer now, in plain text, based on that reasoning.';
  }
  return 'Your previous response had no content. Provide your complete final answer now in plain text.';
}

/** D-E: a truncated turn was cut off — it should be allowed to CONTINUE (incl. tools), not be told
 * "do not call any more tools" (which the reasoning_only/no_content path appends). */
export function nudgeForbidsTools(kind: EmptyResponseKind): boolean {
  return kind !== 'truncated';
}
