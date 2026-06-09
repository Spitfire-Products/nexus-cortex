/**
 * OpenAI Responses API Model Configurator
 *
 * Factory functions for creating OpenAI model configurations using the Responses API pattern.
 * Handles GPT-5 Codex and other models with server-side tool execution.
 *
 * Phase 1: Configurator Extraction
 */

import type { ModelConfig } from '../ModelConfig.interface.js';

export interface OpenAIResponsesModelOptions {
  id: string;
  displayName: string;
  family: string;
  contextWindow: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  supportsTools?: boolean;
  /** Enable reasoning modality for visible thinking traces */
  supportsReasoning?: boolean;
}

export function createOpenAIResponsesModelConfig(options: OpenAIResponsesModelOptions): ModelConfig {
  const supportsTools = options.supportsTools !== undefined ? options.supportsTools : true;
  const supportsReasoning = options.supportsReasoning || false;

  return {
    id: options.id,
    provider: 'openai',
    displayName: options.displayName,
    family: options.family,

    api: {
      pattern: 'responses',
      endpoint: 'https://api.openai.com/v1/responses',
      apiKeyEnvVar: 'OPENAI_API_KEY',
      authHeader: 'Authorization',
      authPrefix: 'Bearer'
    },

    tools: {
      supported: supportsTools,
      adapter: 'ResponsesAPIAdapter',
      namingConvention: 'snake_case',
      maxTools: supportsTools ? 128 : 0,
      parallelToolCalls: supportsTools
    },

    // R20: cards built with this configurator are statically on /v1/responses;
    // expose the same hosted-tools surface that the dynamic-switch GPT-5 cards
    // get so ServerSideToolDetection treats them consistently.
    serverSideTools: {
      supported: true,
      supportedEndpoints: ['responses'],
      availableTools: [
        'web_search',
        'web_search_preview',
        'code_interpreter',
        'file_search',
        'image_generation',
        'computer_use_preview',
        'mcp',
      ],
      metadata: {
        supportsCitations: true,
        supportsToolUsage: true,
        supportsReasoningTokens: true,
      },
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
        paramName: 'max_output_tokens',  // Responses API uses max_output_tokens
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
      tokensPerMinute: 150000
    },

    streaming: {
      supported: true,
      format: 'sse'
    },

    // Add reasoning config if supported (uses Responses API modalities)
    ...(supportsReasoning && {
      reasoning: {
        supported: true,
        format: 'reasoning_item',        // Responses API returns reasoning items
        extractionMethod: 'output_item', // Extract from output array
        pattern: 'upfront' // Reasoning comes before the response
      }
    }),

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
        helperModelId: supportsTools ? 'gpt-4o-mini' : undefined
      }
    },

    cost: {
      inputPerMillion: options.inputCost,
      outputPerMillion: options.outputCost
    }
  };
}
