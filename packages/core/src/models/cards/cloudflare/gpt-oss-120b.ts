/**
 * GPT-OSS 120B via Cloudflare Workers AI (@cf/openai/gpt-oss-120b)
 *
 * OpenAI's open-weight 120B model. NOT available through OpenAI's own API —
 * only via Cloudflare Workers AI hosting. Reasoning + native tool calling.
 */
import { createCloudflareModelConfig } from '../../configurators/CloudflareConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const cfGptOss120b: ModelConfig = createCloudflareModelConfig({
  id: '@cf/openai/gpt-oss-120b',
  displayName: 'GPT-OSS 120B (Cloudflare)',
  family: 'gpt-oss',
  contextWindow: 128000,
  outputTokens: 8192,
  inputCost: 0.40,
  outputCost: 1.20,
  supportsReasoning: true,
});
