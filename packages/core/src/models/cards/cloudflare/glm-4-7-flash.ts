/**
 * GLM 4.7 Flash via Cloudflare Workers AI (@cf/zai-org/glm-4.7-flash)
 *
 * CORTEX notes: "Very cheap reasoning + native tool calling."
 * Zhipu AI's GLM-4.7 routed through CF — no separate ZHIPU_API_KEY required.
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfGlm47Flash: ModelConfig = createCloudflareModelConfig({
  id: '@cf/zai-org/glm-4.7-flash',
  displayName: 'GLM 4.7 Flash (Cloudflare)',
  family: 'glm',
  contextWindow: 131072,
  outputTokens: 8192,
  inputCost: 0.10,
  outputCost: 0.30,
  supportsReasoning: true,
});
