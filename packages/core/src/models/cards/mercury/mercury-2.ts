/**
 * Mercury 2 (mercury-2) — Inception Labs
 * The first diffusion large language model (dLLM). Discrete-diffusion approach
 * runs 5-10x faster than speed-optimized autoregressive models while matching
 * their quality. OpenAI Chat Completions-compatible, tool-use capable.
 *
 * Best for: high-throughput / low-latency coding + chat where speed matters.
 * Context: 128K tokens · Max output: 50K
 * Cost: $0.25 input / $0.75 output per million ($0.025 cached read)
 *
 * Verified against the live Inception API (2026-06-07). `mercury-2` is the only
 * model on the CHAT endpoint (`/v1/chat/completions`). The `mercury-coder` /
 * `mercury-coder-small` / `mercury-edit*` variants DO exist on the direct API,
 * but only on the FIM / edit endpoints (`/v1/fim/completions`,
 * `/v1/edit/completions`) — they are fill-in-the-middle / inline-completion
 * models with NO chat or tool-calling ("Tool calling and function calling are
 * not supported" per the FIM docs), so they cannot serve as CORTEX agentic
 * models without a dedicated FIM adapter, and even then could not call tools.
 * For agentic chat, `mercury-2` is the only usable Mercury model. (mercury-2
 * does NOT respond on `/v1/responses` — 404 — so it has exactly one API.)
 */

import { createMercuryModelConfig } from '../../configurators/MercuryConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const mercury2: ModelConfig = createMercuryModelConfig({
  id: 'mercury-2',
  displayName: 'Mercury 2',
  family: 'mercury',
  contextWindow: 128000,
  outputTokens: 50000,
  inputCost: 0.25,
  outputCost: 0.75,
  cachedInputCost: 0.025
});
