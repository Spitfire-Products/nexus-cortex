/**
 * QwQ 32B via Cloudflare Workers AI (@cf/qwen/qwq-32b)
 *
 * Qwen's reasoning-focused model. CORTEX notes: "native tool calling works
 * despite docs" (CF docs claim no tool support but it works in practice).
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfQwq32b: ModelConfig = createCloudflareModelConfig({
  id: '@cf/qwen/qwq-32b',
  displayName: 'QwQ 32B (Cloudflare)',
  family: 'qwen',
  contextWindow: 24576,
  outputTokens: 8192,
  inputCost: 0.20,
  outputCost: 0.60,
  supportsReasoning: true,
});
