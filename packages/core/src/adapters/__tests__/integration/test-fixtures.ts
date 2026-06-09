/**
 * Test Fixtures for Integration Tests
 *
 * Provides helper functions and mock data for integration testing.
 *
 * Phase 1.5: Week 1 Integration Testing
 */

import { ModelConfig } from '../../../models/ModelConfig.interface';

/**
 * Create test model configuration for a given provider
 */
export function createTestModelConfig(provider: 'anthropic' | 'openai' | 'google'): ModelConfig {
  if (provider === 'anthropic') {
    return {
      id: 'claude-sonnet-4-5-20250929',
      provider: 'anthropic',
      family: 'claude-3',
      displayName: 'Claude 3.5 Sonnet',
      api: {
        pattern: 'messages',
        endpoint: 'https://api.anthropic.com/v1/messages',
        authHeader: 'x-api-key',
        authPrefix: '',
        apiKeyEnvVar: 'ANTHROPIC_API_KEY',
        versionHeader: {
          name: 'anthropic-version',
          value: '2023-06-01'
        }
      },
      limits: {
        contextWindow: 200000,
        outputTokens: 8192,
        requestsPerMinute: 4000,
        tokensPerMinute: 400000
      },
      parameters: {
        temperature: {
          supported: true,
          paramName: 'temperature',
          min: 0,
          max: 1,
          default: 1
        },
        maxTokens: {
          supported: true,
          paramName: 'max_tokens',
          min: 1,
          max: 8192,
          default: 4096
        },
        topP: {
          supported: true,
          paramName: 'top_p',
          min: 0,
          max: 1,
          default: 1
        },
        topK: {
          supported: true,
          paramName: 'top_k',
          min: 0,
          max: 500,
          default: 5
        }
      },
      tools: {
        supported: true,
        adapter: 'MessagesAPIAdapter',
        namingConvention: 'snake_case',
        maxTools: 1024,
        parallelToolCalls: true
      },
      streaming: {
        supported: true,
        format: 'sse'
      },
      compaction: {
        strategy: 'auto',
        thresholdCalculation: {
          method: 'percentage',
          percentage: 0.75,
          safetyMargin: 10000
        },
        behavior: {
          preserveRecent: 10,
          compactOlder: true,
          useHelperModel: true,
          helperModelId: 'gemma-3-27b-it'
        }
      }
    };
  }

  if (provider === 'openai') {
    return {
      id: 'gpt-4o',
      provider: 'openai',
      family: 'gpt-4',
      displayName: 'GPT-4o',
      api: {
        pattern: 'chat/completions',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        authHeader: 'Authorization',
        authPrefix: 'Bearer',
        apiKeyEnvVar: 'OPENAI_API_KEY'
      },
      limits: {
        contextWindow: 128000,
        outputTokens: 16384,
        requestsPerMinute: 5000,
        tokensPerMinute: 800000
      },
      parameters: {
        temperature: {
          supported: true,
          paramName: 'temperature',
          min: 0,
          max: 2,
          default: 1
        },
        maxTokens: {
          supported: true,
          paramName: 'max_tokens',
          min: 1,
          max: 16384,
          default: 4096
        },
        topP: {
          supported: true,
          paramName: 'top_p',
          min: 0,
          max: 1,
          default: 1
        }
      },
      tools: {
        supported: true,
        adapter: 'ChatCompletionsAPIAdapter',
        namingConvention: 'snake_case',
        maxTools: 128,
        parallelToolCalls: true
      },
      streaming: {
        supported: true,
        format: 'sse'
      },
      compaction: {
        strategy: 'auto',
        thresholdCalculation: {
          method: 'percentage',
          percentage: 0.75,
          safetyMargin: 10000
        },
        behavior: {
          preserveRecent: 10,
          compactOlder: true,
          useHelperModel: true,
          helperModelId: 'gemma-3-27b-it'
        }
      }
    };
  }

  // Google/Gemini
  return {
    id: 'gemini-2.0-flash-exp',
    provider: 'google',
    family: 'gemini',
    displayName: 'Gemini 2.0 Flash Experimental',
    api: {
      pattern: 'generateContent',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
      authHeader: 'x-goog-api-key',
      authPrefix: '',
      apiKeyEnvVar: 'GOOGLE_API_KEY'
    },
    limits: {
      contextWindow: 1048576,
      outputTokens: 8192,
      requestsPerMinute: 1000,
      tokensPerMinute: 4000000
    },
    parameters: {
      temperature: {
        supported: true,
        paramName: 'temperature',
        path: 'generationConfig.temperature',
        min: 0,
        max: 2,
        default: 1
      },
      maxTokens: {
        supported: true,
        paramName: 'maxOutputTokens',
        path: 'generationConfig.maxOutputTokens',
        min: 1,
        max: 8192,
        default: 4096
      },
      topP: {
        supported: true,
        paramName: 'topP',
        path: 'generationConfig.topP',
        min: 0,
        max: 1,
        default: 0.95
      },
      topK: {
        supported: true,
        paramName: 'topK',
        path: 'generationConfig.topK',
        min: 1,
        max: 40,
        default: 40
      }
    },
    tools: {
      supported: true,
      adapter: 'GenerateContentAPIAdapter',
      namingConvention: 'snake_case',
      maxTools: 128,
      parallelToolCalls: false
    },
    streaming: {
      supported: true,
      format: 'sse'
    },
    compaction: {
      strategy: 'auto',
      thresholdCalculation: {
        method: 'percentage',
        percentage: 0.75,
        safetyMargin: 10000
      },
      behavior: {
        preserveRecent: 10,
        compactOlder: true,
        useHelperModel: true,
        helperModelId: 'gemma-3-27b-it'
      }
    }
  };
}

/**
 * Create test session context
 */
export function createTestSessionContext() {
  return {
    sessionId: 'test-session-001',
    conversationId: 'test-conv-001',
    turnNumber: 0
  };
}

/**
 * Create test tool definition
 */
export function createTestTool(name: string) {
  return {
    name,
    description: `Test tool: ${name}`,
    schema: {
      type: 'object' as const,
      properties: {
        input: {
          type: 'string' as const,
          description: 'Input parameter'
        }
      },
      required: ['input']
    }
  };
}
