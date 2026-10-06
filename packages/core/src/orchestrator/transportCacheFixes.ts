/**
 * Transport prompt-cache + correctness fixes R224a / R225 / R229 / R230 (2026-10-02; caching audit
 * .cortex/research/caching-audit-2026-10-02.md). Each is DARK behind its own env flag; with the flag off the
 * callers take their pre-existing code path unchanged (byte-identical requests).
 *
 * - R229 CORTEX_GEMINI_SYSTEM_FIX: Gemini never received the system prompt. REST generateContent (non-streaming)
 *   sent no `system_instruction`; the non-tool @google/generative-ai SDK paths sent none either (that SDK is
 *   v0.2.1 on the v1 endpoint and has no systemInstruction support, so with the flag on those requests go through
 *   the v1beta REST builders instead); the @google/genai SDK paths set a TOP-LEVEL `systemInstruction`, which the
 *   SDK drops (GenerateContentParameters = {model, contents, config}) — it must be `config.systemInstruction`.
 * - R230 CORTEX_STABLE_TOOL_ORDER: xAI hybrid server+client tools (ENABLE_SERVER_SIDE_TOOLS) put the server
 *   tools FIRST on the first request of each user turn while continuations use the original order → the tools
 *   array (prefix head) was reordered at every user-turn boundary. On: the original order on every request.
 * - R225 CORTEX_OPENAI_CACHE_KEY: OpenAI chat/completions + Responses get `prompt_cache_key` = the session id
 *   (the value xAI already receives) so same-session requests route to the same cache.
 * - R225 CORTEX_ANTHROPIC_AUTO_CACHE: Anthropic Messages adds the top-level automatic `cache_control` (moves with
 *   the conversation) beside the explicit system / last-tool markers, only while a breakpoint slot is free
 *   (cap 4, R218 markers counted).
 * - R225 CORTEX_ANTHROPIC_CACHE_TTL=1h: every cache_control this harness emits on the Anthropic path (system,
 *   last tool, R218 history, automatic) carries ttl '1h' — uniform, so the "longer TTL first" ordering rule and
 *   the "last-block marker TTL must equal the automatic TTL" rule both hold. Default (unset / 5m) = unchanged.
 * - R225 CORTEX_FORCED_CHOICE_FULL_TOOLS: a forced named tool_choice keeps the FULL tools array (the provider's
 *   tool_choice does the forcing) instead of narrowing it to the forced tool, so the forced request does not
 *   rewrite the tools prefix twice. ⚠ DeepSeek was observed (2026-08-29) to ignore a named choice when the full
 *   catalog is present — that is why narrowing exists.
 * - R224a CORTEX_STREAM_USAGE: streaming chat/completions sends `stream_options: {include_usage: true}` and the
 *   reassembled final message carries the provider's usage chunk instead of zeros.
 *
 * Pure helpers — no client state. Flags are resolved per call so tests/benches can flip them.
 */
import { countAnthropicBreakpoints, ANTHROPIC_MAX_CACHE_BREAKPOINTS } from './transportFixes.js';

function flagOn(raw: string | undefined): boolean {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1';
}

export function isGeminiSystemFixEnabled(): boolean {
  return flagOn(process.env.CORTEX_GEMINI_SYSTEM_FIX);
}
export function isStableToolOrderEnabled(): boolean {
  return flagOn(process.env.CORTEX_STABLE_TOOL_ORDER);
}
export function isOpenAICacheKeyEnabled(): boolean {
  return flagOn(process.env.CORTEX_OPENAI_CACHE_KEY);
}
export function isAnthropicAutoCacheEnabled(): boolean {
  return flagOn(process.env.CORTEX_ANTHROPIC_AUTO_CACHE);
}
export function isForcedChoiceFullToolsEnabled(): boolean {
  return flagOn(process.env.CORTEX_FORCED_CHOICE_FULL_TOOLS);
}
/** Providers whose chat/completions endpoint accepts `stream_options.include_usage` (OpenAI; DeepSeek live-probed 2026-10-02; Groq). */
export const STREAM_USAGE_DEFAULT_PROVIDERS: ReadonlySet<string> = new Set(['openai', 'deepseek', 'groq']);
/** R236 (2026-10-06): default ON for the providers above (streaming usage was zeros by default — the session ledger, lastUsageAnchor and
 *  the exhaustion token counts were wrong on every stream); explicit CORTEX_STREAM_USAGE=on forces it for any provider, explicit off
 *  disables it everywhere. Unknown providers stay off unless forced (they may reject the field). */
export function isStreamUsageEnabled(provider?: string): boolean {
  const raw = String(process.env.CORTEX_STREAM_USAGE ?? '').trim().toLowerCase();
  if (raw === 'on' || raw === 'true' || raw === '1') return true;
  if (raw === 'off' || raw === 'false' || raw === '0') return false;
  return !!provider && STREAM_USAGE_DEFAULT_PROVIDERS.has(provider.toLowerCase());
}
/** '1h' when CORTEX_ANTHROPIC_CACHE_TTL=1h; undefined = provider default (5 minutes, no ttl field sent). */
export function anthropicCacheTtl(): '1h' | undefined {
  return String(process.env.CORTEX_ANTHROPIC_CACHE_TTL ?? '').trim().toLowerCase() === '1h' ? '1h' : undefined;
}

// ---------------------------------------------------------------------------------------------------------
// R225 — Anthropic automatic cache_control + TTL
// ---------------------------------------------------------------------------------------------------------

function withTtl(node: any, ttl: '1h'): any {
  if (Array.isArray(node)) {
    let changed = false;
    const out = node.map((x) => { const y = withTtl(x, ttl); if (y !== x) changed = true; return y; });
    return changed ? out : node;
  }
  if (!node || typeof node !== 'object') return node;
  let out = node;
  if (node.cache_control && typeof node.cache_control === 'object') {
    out = { ...node, cache_control: { ...node.cache_control, ttl } };
  }
  if (Array.isArray(node.content)) {
    const c = withTtl(node.content, ttl);
    if (c !== node.content) out = { ...out, content: c };
  }
  return out;
}

/**
 * Applies the dark Anthropic cache levers to a built Anthropic Messages request body (Anthropic provider only —
 * never called on the xAI Messages branch). Never mutates the input message/tool/system objects (the messages
 * array may be the orchestrator's cached canonical conversion); replaces the affected arrays on `req` with
 * copies. Returns what it did, for tests/logging.
 */
export function applyAnthropicCacheLevers(req: any): { ttl?: '1h'; auto: boolean } {
  const ttl = anthropicCacheTtl();
  if (ttl) {
    if (Array.isArray(req.system)) req.system = withTtl(req.system, ttl);
    if (Array.isArray(req.tools)) req.tools = withTtl(req.tools, ttl);
    if (Array.isArray(req.messages)) req.messages = withTtl(req.messages, ttl);
  }
  let auto = false;
  if (isAnthropicAutoCacheEnabled() && countAnthropicBreakpoints(req) < ANTHROPIC_MAX_CACHE_BREAKPOINTS) {
    req.cache_control = ttl ? { type: 'ephemeral', ttl } : { type: 'ephemeral' };
    auto = true;
  }
  return { ...(ttl ? { ttl } : {}), auto };
}

// ---------------------------------------------------------------------------------------------------------
// R224a — streaming chat/completions usage
// ---------------------------------------------------------------------------------------------------------

/** OpenAI-shape usage object for the reassembled streaming final message: the provider's usage chunk when it
 *  arrived (all its fields kept — prompt_tokens_details / prompt_cache_hit_tokens …), else the legacy zeros. */
export function streamFinalUsage(providerUsage: any): any {
  if (providerUsage && typeof providerUsage === 'object') return providerUsage;
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}
