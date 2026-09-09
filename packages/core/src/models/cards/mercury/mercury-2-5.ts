/**
 * Mercury 2.5 (mercury-2.5) — Inception Labs
 * The 2.5 iteration of the diffusion LLM (dLLM). +40% intelligence over Mercury 2,
 * quality "comparable to GPT-5.6 Luna (Low) / Gemini 3.5 Flash-Lite / Claude Haiku 4.5",
 * ~1,107 tok/s. Best for high-throughput / low-latency agentic coding + chat.
 *
 * ✅ PROBE-VERIFIED against the live Inception API 2026-09-08 (/v1/models + a tool-call
 * round-trip through /v1/chat/completions):
 *   - id `mercury-2.5`; context 260K; max output 65536; text-only (no vision).
 *   - features: tools + json_mode + structured_outputs. Tool-calls VERIFIED: well-formed
 *     OpenAI-format `tool_calls` with schema-aligned JSON args — ChatCompletionsAPIAdapter works.
 *   - sampling params: temperature + stop ONLY (no reasoning-effort param exposed).
 *
 * 🔴 REASONING-TOKEN BUDGET GOTCHA (verified): Mercury 2.5 DOES reason — the response bills
 *   `completion_tokens_details.reasoning_tokens` (a tool call cost ~254 reasoning + ~26 output
 *   tokens) — but the reasoning text is NOT surfaced (no `reasoning_content`; internal, like the
 *   diffusion refinement). Consequence: a TOO-SMALL max_tokens is consumed by reasoning and
 *   returns EMPTY content/no tool_call (a "say hello" at max_tokens=50 emitted 49 reasoning tokens
 *   and no output). ⇒ give it generous max_tokens (the configurator uses outputTokens as the cap).
 *   The card carries NO reasoning channel (nothing extractable), same as mercury-2.
 *
 * Pricing (per 1M, from /v1/models): STANDARD $0.20 input / $0.75 output / ~$0.02 cache-read.
 *   🔴 LAUNCH PROMO active as of 2026-09-08: the live API bills $0.04 / $0.15 / $0.004 (~80% off).
 *   The card uses the standard (durable) rate; the bench uses verified provider pricing, not this.
 */

import { createMercuryModelConfig } from '../../configurators/MercuryConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const mercury25: ModelConfig = createMercuryModelConfig({
  id: 'mercury-2.5',
  displayName: 'Mercury 2.5',
  family: 'mercury',
  contextWindow: 260000,
  outputTokens: 65536,   // verified /v1/models max_output_length
  inputCost: 0.20,       // standard (launch promo $0.04)
  outputCost: 0.75,      // standard (launch promo $0.15)
  cachedInputCost: 0.02, // standard cache-read (~10% of input; live promo shows $0.004)
});
