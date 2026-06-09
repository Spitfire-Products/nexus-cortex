/**
 * Gemini 2.5 Flash (gemini-2.5-flash)
 * Fast and efficient Gemini 2.5 model
 *
 * Best for: Quick tasks with good capability
 * Cost: $0.15 input / $0.60 output per million tokens
 */

import { createGeminiModelConfig } from "../../configurators/GoogleConfigurator.js";
import type { ModelConfig } from "../../ModelConfig.interface.js";

export const gemini25Flash: ModelConfig = createGeminiModelConfig({
  id: "gemini-2.5-flash",
  displayName: "Gemini 2.5 Flash",
  family: "gemini-2.5",
  contextWindow: 1048576,
  outputTokens: 65536,
  inputCost: 0.15,
  outputCost: 0.6,
  reasoning: {
    supported: true,
    format: "thinking_block",
    extractionMethod: "content_block",
    pattern: "interleaved",
  },
});
