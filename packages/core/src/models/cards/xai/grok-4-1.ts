/**
 * Grok 4.1 Fast Reasoning (grok-4-1-fast-reasoning)
 * xAI's latest flagship with enhanced emotional intelligence, multimodal vision, and agentic tools
 *
 * Aliases: grok-4-1-fast, grok-4-1-fast-reasoning-latest
 *
 * Best for: Complex conversations, creative writing, multimodal analysis (images/videos/memes),
 *           low-hallucination agents with traces in "Thinking" mode
 * Cost: $0.25 input / $0.60 output per million tokens (tools free until Nov 21, 2025; then $10/1K)
 * Limits: 500 RPM, 5M TPM; 1M native context (up to 2M cached)
 */

import { createXAIModelConfig } from "../../configurators/XAIConfigurator.js";
import type { ModelConfig } from "../../ModelConfig.interface.js";

export const grok41FastReasoning: ModelConfig = createXAIModelConfig({
  id: "grok-4-1-fast-reasoning",
  displayName: "Grok 4.1 Fast Reasoning",
  family: "grok-4",
  contextWindow: 1000000, // Clamped from 2M — budget manager can't efficiently manage 2M context
  outputTokens: 128000,
  inputCost: 0.25,
  outputCost: 0.6,
  supportsReasoning: true, // Exposes traces in "Thinking" mode
  reasoningToggleable: false  // Native thinking — always on, XAI Messages API has no thinking toggle param
});
