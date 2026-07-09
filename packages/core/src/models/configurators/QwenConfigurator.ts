/**
 * Qwen Model Configurator (Alibaba Cloud)
 *
 * Factory function for creating Alibaba Qwen (通义千问) model configurations.
 * Supports both DashScope API and Hugging Face deployments.
 *
 * API Docs: https://help.aliyun.com/zh/dashscope/
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface QwenModelOptions {
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

export function createQwenModelConfig(options: QwenModelOptions): ModelConfig {
  const supportsTools = options.supportsTools !== undefined ? options.supportsTools : true;

  // DashScope (Alibaba Cloud) endpoint. For Qwen via Hugging Face, use the generic
  // hf-router card (HF_MODEL_ID) instead — HF serving is handled there, not here.
  const endpoint = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

  const apiKeyEnvVar = 'DASHSCOPE_API_KEY';

  return {
    id: options.id,
    provider: 'qwen',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: 'chat/completions',  // OpenAI-compatible format
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
        default: 0.8,
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
        useHelperModel: supportsTools,
        helperModelId: supportsTools ? 'qwen-turbo' : undefined
      }
    },

    cost: {
      inputPerMillion: options.inputCost,
      outputPerMillion: options.outputCost
    }
  };
}
