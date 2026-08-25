/**
 * imageTtl — request-build-time image eviction (backlog item 7 addendum,
 * MEASURED 2026-08-25): on deepseek-v4-flash-vision-exp an image ANYWHERE in
 * the request disables cache reads for the ENTIRE request (probe: identical
 * repeat cached=0 while a text-only request hit the same 896-token prefix).
 * The image's own ≤384 tokens are irrelevant — one stale image forfeits the
 * ~31× cache-hit discount on every subsequent turn.
 *
 * Fix: after the image has been visible for CORTEX_IMAGE_TTL_TURNS assistant
 * responses (default 3 — enough to look, act, and confirm), the outgoing
 * REQUEST COPY replaces the image block with a deterministic text stub. The
 * session history is never rewritten (append-only invariant; the model can
 * always ReadImage again). The one-time prefix bust at the TTL boundary is
 * the good kind: it restores caching for the rest of the session, and the
 * stub is byte-stable so the prefix re-stabilizes immediately.
 *
 * Pure — applied in convertToCanonicalMessages' request pipeline. MUST NOT
 * mutate the input blocks/arrays (cached wrappers share the content array;
 * same contract as the repair pass: swap arrays, never edit blocks).
 */

import type { CanonicalMessage } from '../adapters/FormatAdapter.interface.js';

/** Resolve the TTL from env. Returns null when eviction is DISABLED
 *  ('off'/'never'/'0'); otherwise a positive integer (default 3). */
export function resolveImageTtlTurns(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = (env.CORTEX_IMAGE_TTL_TURNS ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'never' || raw === '0') return null;
  if (/^\d+$/.test(raw) && Number(raw) > 0) return Number(raw);
  return 3;
}

/** Deterministic stub — NO timestamps or counters, so the request prefix is
 *  byte-stable on every build after the eviction boundary. */
export function imageEvictionStub(): { type: 'text'; text: string } {
  return {
    type: 'text',
    text: '[image evicted from context to restore prompt caching — run ReadImage on the file again if you need to see it]',
  };
}

/**
 * Replace image blocks older than `ttl` assistant responses with the stub,
 * on a request copy. An image's age = number of assistant-role messages
 * appearing AFTER its message in the array.
 */
export function applyImageTtlForRequest(
  messages: CanonicalMessage[],
  ttl: number | null = resolveImageTtlTurns(),
): CanonicalMessage[] {
  if (ttl === null) return messages;
  // Suffix counts of assistant messages, computed once.
  const assistantsAfter = new Array<number>(messages.length);
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    assistantsAfter[i] = count;
    if (messages[i]!.role === 'assistant') count++;
  }
  let changed = false;
  const out = messages.map((msg, i) => {
    if (msg.role !== 'user') return msg;
    if (assistantsAfter[i]! < ttl) return msg;
    if (!msg.content.some((b) => b.type === 'image')) return msg;
    changed = true;
    // Swap the content ARRAY; never mutate shared blocks (cache contract).
    return {
      ...msg,
      content: msg.content.map((b) => (b.type === 'image' ? imageEvictionStub() : b)),
    };
  });
  return changed ? out : messages;
}
