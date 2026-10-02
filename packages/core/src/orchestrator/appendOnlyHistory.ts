/**
 * Append-only request history (prompt-cache restructure, 2026-10-02). Every lever here is DARK (unset/off = byte-identical).
 * Evidence: .cortex/research/caching-audit-2026-10-02.md (RESTRUCTURE PLAN) + prefix-stability-2026-10-02.md (harness).
 * The anchor lift (the one intended tools-array change at the first tool_result boundary) is NOT touched by any of these.
 *
 *  CORTEX_WALL_CACHE_FIX (R221)     off | on — the general safety net: every in-place mutation of a history message whose canonical
 *    conversion may already be cached (the HB-WALL-DROP nudge on the newest tool_result, the steering carriers, the R26 empty-turn repair,
 *    the R154 image stub) drops that message's cached conversion, so every later request carries the mutated bytes (wall nudge + wall
 *    summary persist; the single tail break at the retry remains, the second break on the request after it is gone). The wall drop itself
 *    is unchanged (operator 10-02: dropping the walled tail + nudging the newest tool_result is the deliberate trade).
 *  CORTEX_PERSIST_INJECTED (R223)   off | on — the first request's injected user content (repo-state note, deferred-tool announcement,
 *    MCP / slash-command notes) is what every later request of the session sends for that message; storage + display keep the raw text.
 *  CORTEX_APPEND_ONLY_TOOLS (R222)  off | on — the deferred-tool filter only APPENDS: newly enabled tools go to the end in first-enable
 *    order, nothing is evicted within the orchestrator's lifetime.
 *  CORTEX_KEEP_MENTOR_MESSAGES (R227) off | on — mentor/guidance messages stay in history (no mid-history removal at turn end).
 *  CORTEX_RESPONSES_SLICE_ALL (R228) off | on — every Responses request that chains previous_response_id sends only the items added since
 *    the held response (EndTurn gate, wall/empty retries, inaction retry, tools-off synthesis), and each of those responses moves the
 *    slice checkpoint.
 */

function onOff(v: string | undefined): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'on' || s === 'true' || s === '1';
}

export function resolveWallCacheFix(env: NodeJS.ProcessEnv = process.env): boolean {
  return onOff(env.CORTEX_WALL_CACHE_FIX);
}

export function resolvePersistInjected(env: NodeJS.ProcessEnv = process.env): boolean {
  return onOff(env.CORTEX_PERSIST_INJECTED);
}

export function resolveAppendOnlyTools(env: NodeJS.ProcessEnv = process.env): boolean {
  return onOff(env.CORTEX_APPEND_ONLY_TOOLS);
}

export function resolveKeepMentorMessages(env: NodeJS.ProcessEnv = process.env): boolean {
  return onOff(env.CORTEX_KEEP_MENTOR_MESSAGES);
}

export function resolveResponsesSliceAll(env: NodeJS.ProcessEnv = process.env): boolean {
  return onOff(env.CORTEX_RESPONSES_SLICE_ALL);
}

/**
 * R228: the slice start for a request chained on previous_response_id. `held` = messageCountAtLastResponse (history length right after
 * the held response was pushed). A history that SHRANK below it (HB-WALL-DROP popped the walled turn the server still holds) slices from
 * the current end, so only items appended after the drop are sent. 0 = send everything (no usable checkpoint).
 */
export function chainedSliceStart(held: number, length: number): number {
  if (!(held > 0)) return 0;
  return Math.min(held, length);
}

/** Messages after the newest assistant message (the "tail unit" every steering carrier writes into). */
export function tailUnitAfterLastAssistant(history: readonly any[]): any[] {
  const out: any[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    const role = m?.message?.role ?? m?.role ?? (m?.type === 'assistant' ? 'assistant' : undefined);
    if (role === 'assistant') break;
    out.push(m);
  }
  return out;
}

/**
 * R228 fallback: the provider no longer has the response named by previous_response_id (store off, expired, deleted, other backend).
 * Matched on the error text the Responses APIs return ("Previous response with id '…' not found", "previous_response_id … invalid/expired")
 * or a 404 that names a response. Anything else is not a chain failure and is rethrown untouched.
 */
export function isPreviousResponseUnavailable(err: unknown): boolean {
  const e = err as any;
  const status = Number(e?.status ?? e?.statusCode ?? e?.response?.status ?? e?.error?.status ?? NaN);
  const text = [e?.message, e?.error?.message, e?.error?.code, e?.code, e?.response?.data?.error?.message]
    .filter((x) => typeof x === 'string').join(' ');
  if (/previous[_ ]?response/i.test(text) && /not[_ ]?found|expired|invalid|does not exist|unavailable|no longer|not stored|unknown/i.test(text)) return true;
  return status === 404 && /\bresponse\b/i.test(text);
}
