/**
 * Mercury 3 (mercury-3) — Inception Labs
 * The flagship diffusion LLM (dLLM), released 2026-10-19: ">40x the total parameters of Mercury 1",
 * "on par with or better than GPT-6 Luna and Claude Haiku 5.5", ~1,068 tok/s on NVIDIA GPUs. Aimed at
 * agentic + real-time work. 1M context (Mercury 2.5: 260K).
 *
 * ✅ PROBE-VERIFIED against the live Inception API 2026-10-19 (/v1/models + /v1/chat/completions):
 *   - id `mercury-3`; context_length 1,000,000; max_output_length 131,072; text-only (no vision).
 *   - supported_features: tools + json_mode + structured_outputs; endpoints: chat.completions.
 *   - Tool call VERIFIED: well-formed OpenAI-format `tool_calls` with schema-aligned JSON args
 *     (finish_reason "tool_calls") — ChatCompletionsAPIAdapter works unchanged.
 *   - Streaming VERIFIED (SSE chunks; each chunk also carries a `reasoning_summary: null` field).
 *   - sampling params: temperature + stop ONLY (same as 2.5).
 *
 * 🔴 REASONING-TOKEN BUDGET GOTCHA (inherited from 2.5, re-verified): Mercury 3 reasons INTERNALLY —
 *   usage bills `completion_tokens_details.reasoning_tokens` (a one-tool call: 20; a five-word reply
 *   sent with `reasoning_effort: "high"`: 241) — and the reasoning text is never surfaced (no
 *   `reasoning_content`). `reasoning_effort` is ACCEPTED by the API (no 400) but only inflates the
 *   internal budget; the configurator does not send it. A too-small max_tokens is consumed by
 *   reasoning and returns empty content/no tool_call ⇒ keep the generous outputTokens cap.
 *
 * Pricing (per 1M): LIST $0.20 input / $0.70 output / cached input −90% (≈ $0.02).
 *   🔴 LAUNCH PROMO as of 2026-10-19: −50% ($0.10 / $0.35), no stated end date; the API platform also
 *   grants 100M free tokens, which is why /v1/models currently reports pricing "0" for this model.
 *   The card carries the LIST rate (durable); the bench uses verified provider billing, not this.
 */

import { createMercuryModelConfig } from '../../configurators/MercuryConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const mercury3: ModelConfig = createMercuryModelConfig({
  id: 'mercury-3',
  displayName: 'Mercury 3',
  family: 'mercury',
  contextWindow: 1000000, // verified /v1/models context_length
  outputTokens: 131072,   // verified /v1/models max_output_length
  inputCost: 0.20,        // list (launch promo $0.10; free 100M tokens on the platform)
  outputCost: 0.70,       // list (launch promo $0.35)
  cachedInputCost: 0.02,  // list cached input = −90% of input
});
