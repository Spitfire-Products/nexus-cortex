/**
 * Hugging Face Model Configurator
 *
 * Factory function for creating Hugging Face Inference API model configurations.
 * Supports serverless inference API and dedicated inference endpoints.
 *
 * API Docs: https://huggingface.co/docs/api-inference/index
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface HuggingFaceModelOptions {
  id: string;
  displayName: string;
  family: string;
  contextWindow: number;
  outputTokens: number;
  inputCost?: number;      // Optional - serverless is rate-limited but free
  outputCost?: number;     // Optional - serverless is rate-limited but free
  supportsTools?: boolean;

  /**
   * Hugging Face model ID (e.g., 'meta-llama/Meta-Llama-3-8B-Instruct')
   * If not provided, uses the 'id' field
   */
  huggingFaceModelId?: string;

  /**
   * For dedicated inference endpoints (optional)
   * Format: https://[endpoint-id].us-east-1.aws.endpoints.huggingface.cloud
   */
  customEndpoint?: string;
}

export function createHuggingFaceModelConfig(options: HuggingFaceModelOptions): ModelConfig {
  const supportsTools = options.supportsTools !== undefined ? options.supportsTools : false;
  const modelId = options.huggingFaceModelId || options.id;

  // Use custom endpoint if provided, otherwise use serverless inference API
  const endpoint = options.customEndpoint ||
                  `https://api-inference.huggingface.co/models/${modelId}`;

  return {
    id: options.id,
    provider: 'huggingface',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: 'chat/completions',  // Hugging Face uses OpenAI-compatible format
      endpoint: endpoint,
      apiKeyEnvVar: 'HUGGINGFACE_API_KEY',
      authHeader: 'Authorization',
      authPrefix: 'Bearer'
    },

    tools: {
      supported: supportsTools,
      adapter: 'ChatCompletionsAPIAdapter',
      namingConvention: 'snake_case',
      maxTools: supportsTools ? 128 : 0,
      parallelToolCalls: supportsTools
    },

    parameters: {
      temperature: {
        supported: true,
        paramName: 'temperature',
        min: 0.0,
        max: 2.0
      },
      maxTokens: {
        supported: true,
        paramName: 'max_tokens',
        default: 2048,
        min: 1,
        max: options.outputTokens
      },
      topP: {
        supported: true,
        paramName: 'top_p',
        default: 0.95,
        min: 0.0,
        max: 1.0
      }
    },

    limits: {
      contextWindow: options.contextWindow,
      outputTokens: options.outputTokens,
      requestsPerMinute: 100,    // Serverless API limits
      tokensPerMinute: 100000    // Varies by tier
    },

    streaming: {
      supported: true,
      format: 'sse'
    },

    compaction: {
      strategy: 'auto',
      thresholdCalculation: {
        method: 'percentage',
        percentage: 0.8,
        safetyMargin: 4000
      },
      behavior: {
        preserveRecent: 10,
        compactOlder: true,
        useHelperModel: false
      }
    },

    cost: {
      inputPerMillion: options.inputCost || 0.0,   // Serverless is free (rate-limited)
      outputPerMillion: options.outputCost || 0.0
    }
  };
}
