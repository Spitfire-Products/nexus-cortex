/**
 * ModelConfig Interface
 *
 * Imports model configuration types from @nexus-cortex/types and provides
 * example configurations for testing and reference.
 *
 * Phase 1.5: Multi-Provider Architecture
 * Based on: CORTEX_V4_PHASE_1.5_ARCHITECTURE.md, Part 2.2
 */

import type {
  ModelConfig,
  ParameterConfig,
  HelperModelMapping,
  ModelRegistry,
  ModelCapabilities,
  ModelProvider
} from '@nexus-cortex/types';

// Re-export for backward compatibility
export type {
  ModelConfig,
  ParameterConfig,
  HelperModelMapping,
  ModelRegistry,
  ModelCapabilities,
  ModelProvider
};

/**
 * Example Model Configurations
 *
 * These demonstrate the comprehensive ModelConfig schema.
 */
export const EXAMPLE_MODEL_CONFIGS: Record<string, Partial<ModelConfig>> = {
  'claude-3-5-sonnet-20241022': {
    id: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    displayName: 'Claude 3.5 Sonnet',
    family: 'claude-3-5',

    api: {
      pattern: 'messages',
      endpoint: 'https://api.anthropic.com/v1/messages',
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      authHeader: 'x-api-key',
      versionHeader: {
        name: 'anthropic-version',
        value: '2023-06-01'
      }
    },

    tools: {
      supported: true,
      adapter: 'MessagesAPIAdapter',
      namingConvention: 'snake_case',
      maxTools: 64,
      parallelToolCalls: true,
      supportsToolChoice: true,
      toolChoiceOptions: ['auto', 'required', 'specific']
    },

    limits: {
      contextWindow: 200000,
      outputTokens: 8192,
      requestsPerMinute: 50,
      tokensPerMinute: 100000
    },

    compaction: {
      strategy: 'auto',
      thresholdCalculation: {
        method: 'percentage',
        percentage: 0.75, // Trigger at 150k tokens (75% of 200k)
        safetyMargin: 10000
      },
      behavior: {
        preserveRecent: 10,
        compactOlder: true,
        useHelperModel: true,
        helperModelId: 'claude-haiku-4-5'
      }
    },

    cost: {
      inputPerMillion: 3.0,
      outputPerMillion: 15.0
    }
  },

  'gpt-4': {
    id: 'gpt-4',
    provider: 'openai',
    displayName: 'GPT-4',
    family: 'gpt-4',

    api: {
      pattern: 'chat/completions',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKeyEnvVar: 'OPENAI_API_KEY',
      authHeader: 'Authorization',
      authPrefix: 'Bearer'
    },

    tools: {
      supported: true,
      adapter: 'ChatCompletionsAPIAdapter',
      namingConvention: 'PascalCase',
      maxTools: 128,
      parallelToolCalls: true,
      supportsToolChoice: true,
      toolChoiceOptions: ['auto', 'required', 'none']
    },

    limits: {
      contextWindow: 8192,
      outputTokens: 4096,
      requestsPerMinute: 500,
      tokensPerMinute: 150000
    },

    compaction: {
      strategy: 'auto',
      thresholdCalculation: {
        method: 'percentage',
        percentage: 0.70, // Trigger at ~5.7k tokens (70% of 8k)
        safetyMargin: 2000
      },
      behavior: {
        preserveRecent: 5,
        compactOlder: true,
        useHelperModel: true,
        helperModelId: 'gpt-3.5-turbo'
      }
    },

    cost: {
      inputPerMillion: 30.0,
      outputPerMillion: 60.0
    }
  },

  'gemini-2.0-flash-exp': {
    id: 'gemini-2.0-flash-exp',
    provider: 'google',
    displayName: 'Gemini 2.0 Flash (Experimental)',
    family: 'gemini-2.0',

    api: {
      pattern: 'generateContent',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp',
      apiKeyEnvVar: 'GOOGLE_API_KEY',
      authHeader: 'x-goog-api-key'
    },

    tools: {
      supported: true,
      adapter: 'GenerateContentAPIAdapter',
      namingConvention: 'snake_case',
      maxTools: 9999, // Effectively unlimited
      parallelToolCalls: false
    },

    limits: {
      contextWindow: 1000000, // 1M tokens
      outputTokens: 8192,
      requestsPerMinute: 1500,
      tokensPerMinute: 4000000
    },

    compaction: {
      strategy: 'auto',
      thresholdCalculation: {
        method: 'percentage',
        percentage: 0.90, // Trigger at 900k tokens (90% of 1M)
        safetyMargin: 50000
      },
      behavior: {
        preserveRecent: 50,
        compactOlder: true,
        useHelperModel: false // Gemini Flash is already cheap
      }
    },

    cost: {
      inputPerMillion: 0.075,
      outputPerMillion: 0.30
    },

    metadata: {
      preview: true
    }
  }
};