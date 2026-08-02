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

export type EmptyResponseKind = 'not_empty' | 'reasoning_only' | 'no_visible_content';

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

export function classifyEmptyResponse(content: unknown): EmptyResponseClassification {
  const bs = blocks(content);
  const hadReasoning = bs.some(
    (b) => b?.type === 'thinking' || b?.type === 'redacted_thinking',
  );
  const hadToolUse = bs.some((b) => b?.type === 'tool_use');

  if (hasVisibleAssistantText(content as any) || hadToolUse) {
    return { kind: 'not_empty', hadReasoning, hadToolUse };
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
  if (kind === 'reasoning_only') {
    return 'You produced reasoning but no visible answer. Write out your complete final answer now, in plain text, based on that reasoning.';
  }
  return 'Your previous response had no content. Provide your complete final answer now in plain text.';
}
