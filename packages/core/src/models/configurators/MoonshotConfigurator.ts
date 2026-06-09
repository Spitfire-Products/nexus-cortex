/**
 * Moonshot AI Model Configurator
 *
 * Factory function for creating Moonshot AI model configurations.
 * Moonshot (月之暗面) provides Kimi models optimized for Chinese language.
 *
 * API Docs: https://platform.moonshot.cn/docs
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface MoonshotModelOptions {
  id: string;
  displayName: string;
  family: string;
  contextWindow: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  supportsTools?: boolean;
}

export function createMoonshotModelConfig(options: MoonshotModelOptions): ModelConfig {
  const supportsTools = options.supportsTools !== undefined ? options.supportsTools : true;

  return {
    id: options.id,
    provider: 'moonshot',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: 'chat/completions',  // OpenAI-compatible API
      endpoint: 'https://api.moonshot.cn/v1/chat/completions',
      apiKeyEnvVar: 'MOONSHOT_API_KEY',
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
        max: 1.0
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
      requestsPerMinute: 60,
      tokensPerMinute: 120000
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
        useHelperModel: false  // Use same model for compaction
      }
    },

    cost: {
      inputPerMillion: options.inputCost,
      outputPerMillion: options.outputCost
    }
  };
}
