/**
 * Local Model Configurator
 *
 * Factory function for creating local model configurations.
 * Supports LMStudio, Ollama, LocalAI, and any OpenAI-compatible local server.
 *
 * Features:
 * - Custom endpoint configuration (default: http://localhost:1234)
 * - Optional API key (many local servers don't require auth)
 * - Zero cost (local inference)
 * - OpenAI-compatible API pattern
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface LocalModelOptions {
  id: string;
  displayName: string;
  family: string;
  contextWindow: number;
  outputTokens: number;

  /** Local server endpoint (e.g., http://localhost:1234/v1) */
  endpoint?: string;

  /** API key environment variable (optional, many local servers don't need auth) */
  apiKeyEnvVar?: string;

  /** Whether the model supports tool calling */
  supportsTools?: boolean;

  /** Custom provider name (default: 'local') */
  provider?: string;
}

export function createLocalModelConfig(options: LocalModelOptions): ModelConfig {
  const endpoint = options.endpoint || 'http://localhost:1234/v1/chat/completions';
  const apiKeyEnvVar = options.apiKeyEnvVar || 'LOCAL_MODEL_API_KEY';
  const supportsTools = options.supportsTools !== undefined ? options.supportsTools : true;
  const provider = options.provider || 'local';

  return {
    id: options.id,
    provider: provider,
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: 'chat/completions',
      endpoint: endpoint,
      apiKeyEnvVar: apiKeyEnvVar,
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
        default: 4096,
        min: 1,
        max: options.outputTokens
      },
      topP: {
        supported: true,
        paramName: 'top_p',
        default: 1.0,
        min: 0.0,
        max: 1.0
      }
    },

    limits: {
      contextWindow: options.contextWindow,
      outputTokens: options.outputTokens,
      requestsPerMinute: 1000,  // No rate limits for local
      tokensPerMinute: 1000000  // No rate limits for local
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
        useHelperModel: false  // Don't use helper for local models
      }
    },

    cost: {
      inputPerMillion: 0.0,   // FREE - local inference
      outputPerMillion: 0.0   // FREE - local inference
    }
  };
}
