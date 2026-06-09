/**
 * IBM Granite 4.0 H Micro via Cloudflare Workers AI
 * (@cf/ibm-granite/granite-4.0-h-micro)
 *
 * CORTEX notes: "Cheapest model overall." Native tool calling.
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfGranite4: ModelConfig = createCloudflareModelConfig({
  id: '@cf/ibm-granite/granite-4.0-h-micro',
  displayName: 'Granite 4.0 Micro (Cloudflare)',
  family: 'granite',
  contextWindow: 131072,
  outputTokens: 8192,
  inputCost: 0.05,
  outputCost: 0.15,
});
