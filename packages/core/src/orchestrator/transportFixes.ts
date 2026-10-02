/**
 * Transport fixes R215 / R216 / R218 (2026-10-02, transport map 10-02). Each is DARK behind its own env flag;
 * with the flag off the callers take their pre-existing code path unchanged (byte-identical requests).
 *
 * - R215 CORTEX_RESPONSES_INLINE_REMINDERS: on the Responses path, keep `<system-reminder>` text IN PLACE as
 *   user `input_text` items instead of extracting it into `instructions` (which xAI never receives, and which
 *   moves reminders away from the tool output they annotate on OpenAI).
 * - R216 CORTEX_RESPONSES_STOP_REASON: map the Responses API truncation signal (status 'incomplete' +
 *   incomplete_details.reason 'max_output_tokens') and the hf-space finish_reason to stop reasons the
 *   empty-response classifier understands.
 * - R218 CORTEX_ANTHROPIC_HISTORY_CACHE: rolling message-level cache_control breakpoints on the Anthropic
 *   Messages path (never the xAI Messages branch), within Anthropic's 4-breakpoint cap.
 *
 * Pure helpers — no client state. Flags are resolved per call so tests/benches can flip them.
 */

function flagOn(raw: string | undefined): boolean {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1';
}

export function isResponsesInlineRemindersEnabled(): boolean {
  return flagOn(process.env.CORTEX_RESPONSES_INLINE_REMINDERS);
}

export function isResponsesStopReasonEnabled(): boolean {
  return flagOn(process.env.CORTEX_RESPONSES_STOP_REASON);
}

export function isAnthropicHistoryCacheEnabled(): boolean {
  return flagOn(process.env.CORTEX_ANTHROPIC_HISTORY_CACHE);
}

// ---------------------------------------------------------------------------------------------------------
// R215 — in-order reminder carrier for the Responses API
// ---------------------------------------------------------------------------------------------------------

/**
 * Keep reminder text where the conversation put it. The ResponsesAPIAdapter emits a canonical user message
 * that carries [tool_result..., text] as `message{user, input_text}` FOLLOWED BY its `function_call_output`
 * items (adapters/ResponsesAPIAdapter.ts toProviderMessages), so a reminder written beside a tool result would
 * land BEFORE the tool output, between the function_call and its output. Here each user message item that is
 * immediately followed by function_call_output items is moved after them: tool outputs first, then the user
 * text (reminders included, unchanged `<system-reminder>` tags). Nothing is removed and no item is rewritten.
 */
export function inlineRemindersForResponses(inputItems: any[]): any[] {
  if (!Array.isArray(inputItems)) return inputItems;
  const out: any[] = [];
  let i = 0;
  while (i < inputItems.length) {
    const item = inputItems[i];
    const isUserMsg = item && item.type === 'message' && item.role === 'user';
    if (isUserMsg) {
      let j = i + 1;
      while (j < inputItems.length && inputItems[j]?.type === 'function_call_output') j++;
      if (j > i + 1) {
        for (let k = i + 1; k < j; k++) out.push(inputItems[k]);
        out.push(item);
        i = j;
        continue;
      }
    }
    out.push(item);
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// R216 — Responses / hf-space stop reasons
// ---------------------------------------------------------------------------------------------------------

/**
 * Responses API (verified live on DeepSeek 2026-10-02, non-streaming AND the streaming `response.incomplete`
 * event's `response`): `{ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }`.
 * Truncation → 'max_output_tokens' (in the classifier's TRUNCATION_STOP set). Any other incomplete reason is
 * passed through as-is (e.g. 'content_filter'; unverified live); otherwise the status ('completed', ...).
 */
export function mapResponsesStopReason(resp: any): string | undefined {
  if (!resp || typeof resp !== 'object') return undefined;
  const status = typeof resp.status === 'string' ? resp.status : undefined;
  if (status === 'incomplete') {
    const reason = resp.incomplete_details?.reason;
    if (reason === 'max_output_tokens') return 'max_output_tokens';
    return typeof reason === 'string' && reason ? reason : 'incomplete';
  }
  return status;
}

/** hf-space returns an OpenAI chat.completion shape built in APIClient.sendHFSpaceAPI. */
export function mapHFSpaceStopReason(resp: any): string | undefined {
  const fr = resp?.choices?.[0]?.finish_reason;
  return typeof fr === 'string' ? fr : undefined;
}

// ---------------------------------------------------------------------------------------------------------
// R218 — rolling message-level cache breakpoints (Anthropic Messages)
// ---------------------------------------------------------------------------------------------------------

/** Anthropic allows at most 4 cache_control breakpoints per request (system + tools + messages). */
export const ANTHROPIC_MAX_CACHE_BREAKPOINTS = 4;

function countCacheControl(node: any): number {
  if (Array.isArray(node)) return node.reduce((n, x) => n + countCacheControl(x), 0);
  if (!node || typeof node !== 'object') return 0;
  let n = node.cache_control ? 1 : 0;
  if (Array.isArray(node.content)) n += countCacheControl(node.content);
  return n;
}

/** Breakpoints already present in an Anthropic request body (system, tools, messages). */
export function countAnthropicBreakpoints(req: { system?: any; tools?: any[]; messages?: any[] }): number {
  return countCacheControl(Array.isArray(req.system) ? req.system : [])
    + countCacheControl(req.tools ?? [])
    + countCacheControl(req.messages ?? []);
}

/** Index of the last content block that may carry cache_control (not thinking, not empty text), or -1. */
function markableBlockIndex(content: any[]): number {
  for (let k = content.length - 1; k >= 0; k--) {
    const b = content[k];
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'thinking' || b.type === 'redacted_thinking') continue;
    if (b.type === 'text' && !(typeof b.text === 'string' && b.text.length > 0)) continue;
    return k;
  }
  return -1;
}

/** Returns a copy of the message with cache_control on its last markable block, or null when none. */
function markMessage(msg: any): any | null {
  if (!msg) return null;
  if (typeof msg.content === 'string') {
    if (!msg.content) return null;
    return { ...msg, content: [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }] };
  }
  if (!Array.isArray(msg.content)) return null;
  const idx = markableBlockIndex(msg.content);
  if (idx < 0) return null;
  const content = msg.content.slice();
  content[idx] = { ...content[idx], cache_control: { type: 'ephemeral' } };
  return { ...msg, content };
}

/**
 * Add up to two rolling breakpoints on user messages: first the previous user message (the stable prefix the
 * last request wrote — read hit even past the 20-block lookback), then the newest user message (written now,
 * read by the next request). Only as many as the remaining cap allows (4 minus breakpoints already in the
 * request). Never mutates the input; returns the same array when nothing is added.
 */
export function applyAnthropicHistoryCache(messages: any[], usedBreakpoints: number): { messages: any[]; added: number } {
  if (!Array.isArray(messages) || messages.length === 0) return { messages, added: 0 };
  let available = ANTHROPIC_MAX_CACHE_BREAKPOINTS - usedBreakpoints - countCacheControl(messages);
  if (available <= 0) return { messages, added: 0 };

  const userIdx: number[] = [];
  messages.forEach((m, i) => { if (m?.role === 'user') userIdx.push(i); });
  if (userIdx.length === 0) return { messages, added: 0 };
  const newest = userIdx[userIdx.length - 1];
  const prev = userIdx.length >= 2 ? userIdx[userIdx.length - 2] : undefined;
  const targets = (prev !== undefined ? [prev, newest] : [newest]) as number[];

  let out = messages;
  let added = 0;
  for (const t of targets) {
    if (available <= 0) break;
    if (countCacheControl(out[t]) > 0) continue; // already a breakpoint here
    const marked = markMessage(out[t]);
    if (!marked) continue;
    if (out === messages) out = messages.slice();
    out[t] = marked;
    added++;
    available--;
  }
  return { messages: out, added };
}
