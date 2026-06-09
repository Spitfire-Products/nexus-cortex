/**
 * DeepSeek Model Configurator
 *
 * Factory functions for creating DeepSeek model configurations using the Chat Completions API pattern.
 * Handles DeepSeek Chat, DeepSeek Reasoner, and DeepSeek Coder families.
 *
 * Phase 1: Configurator Extraction
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface DeepSeekModelOptions {
  id: string;
  displayName: string;
  family: string;
  contextWindow: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  reasoning?: {
    supported: boolean;
    format?: 'reasoning_content' | 'thinking_block';
    extractionMethod?: 'content_block' | 'separate_field';
    pattern?: 'upfront' | 'interleaved';
  };
}

export function createDeepSeekModelConfig(options: DeepSeekModelOptions): ModelConfig {
  return {
    id: options.id,
    provider: 'deepseek',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: 'chat/completions',
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      apiKeyEnvVar: 'DEEPSEEK_API_KEY',
      authHeader: 'Authorization',
      authPrefix: 'Bearer'
    },

    tools: {
      supported: true,
      adapter: 'ChatCompletionsAPIAdapter',
      namingConvention: 'snake_case',
      maxTools: 128,
      parallelToolCalls: true
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
      requestsPerMinute: 500,
      tokensPerMinute: 500000
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
        useHelperModel: true
      }
    },

    cost: {
      inputPerMillion: options.inputCost,
      outputPerMillion: options.outputCost
    },

    reasoning: options.reasoning
  };
}
