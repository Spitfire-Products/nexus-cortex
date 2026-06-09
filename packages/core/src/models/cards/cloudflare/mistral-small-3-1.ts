/**
 * Mistral Small 3.1 24B Instruct via Cloudflare Workers AI
 * (@cf/mistralai/mistral-small-3.1-24b-instruct)
 *
 * Vision + native tool calling (no reasoning traces).
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfMistralSmall31: ModelConfig = createCloudflareModelConfig({
  id: '@cf/mistralai/mistral-small-3.1-24b-instruct',
  displayName: 'Mistral Small 3.1 24B (Cloudflare)',
  family: 'mistral',
  contextWindow: 128000,
  outputTokens: 8192,
  inputCost: 0.15,
  outputCost: 0.45,
  supportsVision: true,
});
