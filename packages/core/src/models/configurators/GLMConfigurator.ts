/**
 * GLM Model Configurator (Zhipu AI)
 *
 * Factory function for creating Zhipu AI GLM model configurations.
 * GLM (General Language Model) from Zhipu AI (智谱AI).
 *
 * API Docs: https://open.bigmodel.cn/dev/api
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface GLMModelOptions {
  id: string;
  displayName: string;
  family: string;
  contextWindow: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
}

export function createGLMModelConfig(options: GLMModelOptions): ModelConfig {
  const supportsTools = options.supportsTools !== undefined ? options.supportsTools : true;

  return {
    id: options.id,
    provider: 'zhipu',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: 'chat/completions',  // OpenAI-compatible API
      endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      apiKeyEnvVar: 'ZHIPU_API_KEY',
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
        default: 0.7,
        min: 0.0,
        max: 1.0
      }
    },

    limits: {
      contextWindow: options.contextWindow,
      outputTokens: options.outputTokens,
      requestsPerMinute: 100,
      tokensPerMinute: 150000
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
        useHelperModel: supportsTools,
        helperModelId: supportsTools ? 'glm-4-flash' : undefined
      }
    },

    cost: {
      inputPerMillion: options.inputCost,
      outputPerMillion: options.outputCost
    }
  };
}
