/**
 * Server-Side Tool Detection Tests
 *
 * Tests for the server-side tool detection and routing logic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldUseServerSideTools,
  isServerSideToolsEnabled,
  modelSupportsServerSideTools,
  containsServerSideTools,
  getResponsesAPIEndpoint,
  getMessagesAPIEndpoint,
  validateServerSideToolRequest
} from '../ServerSideToolDetection';
import type { ModelConfig } from '../../models/ModelConfig.interface';
import type { CanonicalTool } from '../FormatAdapter.interface';

describe('ServerSideToolDetection', () => {
  // Mock XAI model config
  const mockXAIModel: ModelConfig = {
    id: 'grok-4-fast',
    provider: 'xai',
    displayName: 'Grok 4 Fast',
    family: 'grok-4',
    api: {
      pattern: 'messages',
      endpoint: 'https://api.x.ai/v1/messages',
      apiKeyEnvVar: 'XAI_API_KEY',
      authHeader: 'x-api-key',
      authPrefix: ''
    },
    tools: {
      supported: true,
      adapter: 'MessagesAPIAdapter',
      namingConvention: 'snake_case',
      maxTools: 128,
      parallelToolCalls: true
    },
    serverSideTools: {
      supported: true,
      supportedEndpoints: ['responses'],
      availableTools: ['web_search', 'x_search', 'code_execution'],
      metadata: {
        supportsCitations: true,
        supportsToolUsage: true,
        supportsReasoningTokens: true
      }
    },
    parameters: {
      temperature: { supported: true, paramName: 'temperature', default: 0.0 },
      maxTokens: { supported: true, paramName: 'max_tokens', default: 4096 },
      topP: { supported: true, paramName: 'top_p', default: 1.0 }
    },
    limits: {
      contextWindow: 2000000,
      outputTokens: 131072,
      requestsPerMinute: 60,
      tokensPerMinute: 2000000
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
    }
  };

  // Mock Claude model (no server-side tools)
  const mockClaudeModel: ModelConfig = {
    ...mockXAIModel,
    id: 'claude-sonnet-4-5-20250929',
    provider: 'anthropic',
    displayName: 'Claude 3.5 Sonnet',
    family: 'claude-3.5',
    serverSideTools: undefined // No server-side tools
  };

  // Mock tools
  const serverSideTools: CanonicalTool[] = [
    {
      name: 'web_search',
      description: 'Search the web',
      schema: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    {
      name: 'x_search',
      description: 'Search X (Twitter)',
      schema: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  ];

  const clientSideTools: CanonicalTool[] = [
    {
      name: 'read_file',
      description: 'Read a file',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    }
  ];

  describe('isServerSideToolsEnabled', () => {
    it('should return true when ENABLE_SERVER_SIDE_TOOLS is "true"', () => {
      process.env.ENABLE_SERVER_SIDE_TOOLS = 'true';
      expect(isServerSideToolsEnabled()).toBe(true);
    });

    it('should return true when ENABLE_SERVER_SIDE_TOOLS is "1"', () => {
      process.env.ENABLE_SERVER_SIDE_TOOLS = '1';
      expect(isServerSideToolsEnabled()).toBe(true);
    });

    it('should return false when ENABLE_SERVER_SIDE_TOOLS is "false"', () => {
      process.env.ENABLE_SERVER_SIDE_TOOLS = 'false';
      expect(isServerSideToolsEnabled()).toBe(false);
    });

    it('should return false when ENABLE_SERVER_SIDE_TOOLS is not set', () => {
      delete process.env.ENABLE_SERVER_SIDE_TOOLS;
      expect(isServerSideToolsEnabled()).toBe(false);
    });
  });

  describe('modelSupportsServerSideTools', () => {
    it('should return true for XAI model with server-side tools config', () => {
      expect(modelSupportsServerSideTools(mockXAIModel)).toBe(true);
    });

    it('should return false for Claude model without server-side tools config', () => {
      expect(modelSupportsServerSideTools(mockClaudeModel)).toBe(false);
    });
  });

  describe('containsServerSideTools', () => {
    it('should return true when tools contain server-side tools', () => {
      expect(containsServerSideTools('xai', serverSideTools)).toBe(true);
    });

    it('should return false when tools contain only client-side tools', () => {
      expect(containsServerSideTools('xai', clientSideTools)).toBe(false);
    });

    it('should return false for provider that does not support server-side tools', () => {
      expect(containsServerSideTools('anthropic', serverSideTools)).toBe(false);
    });
  });

  describe('shouldUseServerSideTools', () => {
    beforeEach(() => {
      // Reset environment variable before each test
      delete process.env.ENABLE_SERVER_SIDE_TOOLS;
    });

    it('should return false when ENABLE_SERVER_SIDE_TOOLS is not set', () => {
      const result = shouldUseServerSideTools(mockXAIModel, serverSideTools);
      expect(result.useServerSideTools).toBe(false);
      expect(result.reason).toContain('environment variable not set');
    });

    it('should return false when model does not support server-side tools', () => {
      process.env.ENABLE_SERVER_SIDE_TOOLS = 'true';
      const result = shouldUseServerSideTools(mockClaudeModel, serverSideTools);
      expect(result.useServerSideTools).toBe(false);
      expect(result.reason).toContain('does not support server-side tools');
    });

    it('should return false when tools do not contain server-side tools', () => {
      process.env.ENABLE_SERVER_SIDE_TOOLS = 'true';
      const result = shouldUseServerSideTools(mockXAIModel, clientSideTools);
      expect(result.useServerSideTools).toBe(false);
      expect(result.reason).toContain('No server-side tools');
    });

    it('should return true when all criteria are met', () => {
      process.env.ENABLE_SERVER_SIDE_TOOLS = 'true';
      const result = shouldUseServerSideTools(mockXAIModel, serverSideTools);
      expect(result.useServerSideTools).toBe(true);
      expect(result.apiPattern).toBe('responses');
      expect(result.endpoint).toContain('/v1/responses');
      expect(result.tools).toHaveLength(2);
      expect(result.reason).toContain('All criteria met');
    });

    it('should handle mixed client and server tools in hybrid mode', () => {
      process.env.ENABLE_SERVER_SIDE_TOOLS = 'true';
      const mixedTools = [...serverSideTools, ...clientSideTools];
      const result = shouldUseServerSideTools(mockXAIModel, mixedTools);
      expect(result.useServerSideTools).toBe(true);
      expect(result.reason).toContain('Hybrid mode');
      expect(result.tools).toHaveLength(3); // ALL tools — server + client
      expect(result.tools.some(t => t.name === 'web_search')).toBe(true);
      expect(result.tools.some(t => t.name === 'read_file')).toBe(true);
      expect(result.apiPattern).toBe('responses');
      expect(result.endpoint).toContain('/v1/responses');
    });
  });

  describe('getResponsesAPIEndpoint', () => {
    it('should convert XAI Messages API endpoint to Responses API', () => {
      const endpoint = getResponsesAPIEndpoint(mockXAIModel);
      expect(endpoint).toBe('https://api.x.ai/v1/responses');
    });

    it('should handle endpoints without /v1/messages correctly', () => {
      const modelWithDifferentEndpoint: ModelConfig = {
        ...mockXAIModel,
        api: {
          ...mockXAIModel.api,
          endpoint: 'https://api.x.ai/messages'
        }
      };
      const endpoint = getResponsesAPIEndpoint(modelWithDifferentEndpoint);
      expect(endpoint).toContain('/v1/responses');
    });

    it('is idempotent when the endpoint is already /v1/responses (XAI_API_MODE=responses)', () => {
      const alreadyResponses: ModelConfig = {
        ...mockXAIModel,
        api: {
          ...mockXAIModel.api,
          endpoint: 'https://api.x.ai/v1/responses'
        }
      };
      const endpoint = getResponsesAPIEndpoint(alreadyResponses);
      // Must NOT produce the doubled .../v1/responses/v1/responses (→ xAI 404)
      expect(endpoint).toBe('https://api.x.ai/v1/responses');
    });
  });

  describe('getMessagesAPIEndpoint', () => {
    it('should return the default Messages API endpoint', () => {
      const endpoint = getMessagesAPIEndpoint(mockXAIModel);
      expect(endpoint).toBe('https://api.x.ai/v1/messages');
    });
  });

  describe('validateServerSideToolRequest', () => {
    it('should validate successfully for proper XAI server-side tool request', () => {
      const result = validateServerSideToolRequest(mockXAIModel, serverSideTools);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should fail validation when model does not support server-side tools', () => {
      const result = validateServerSideToolRequest(mockClaudeModel, serverSideTools);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('does not support server-side tools');
    });

    it('should allow mixing client and server tools for XAI (hybrid mode)', () => {
      const mixedTools = [...serverSideTools, ...clientSideTools];
      const result = validateServerSideToolRequest(mockXAIModel, mixedTools);
      expect(result.valid).toBe(true); // XAI supports hybrid mode
    });

    it('should report model incompatibility for non-XAI providers', () => {
      // Non-XAI providers with serverSideTools config would still fail on model check
      const nonXAIModel: ModelConfig = {
        ...mockXAIModel,
        id: 'some-future-model',
        provider: 'some-future-provider',
        serverSideTools: undefined, // No server-side tool support
      };
      const result = validateServerSideToolRequest(nonXAIModel, serverSideTools);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('does not support server-side tools');
    });

    it('should warn about unavailable tools', () => {
      const unavailableTool: CanonicalTool = {
        name: 'unknown_tool',
        description: 'Unknown server-side tool',
        schema: { type: 'object', properties: {}, required: [] }
      };
      const result = validateServerSideToolRequest(mockXAIModel, [unavailableTool]);
      // This should pass validation but may have warnings in logs
      // The tool won't be in the registry, so it won't be detected as server-side
      expect(result.valid).toBe(true);
    });
  });
});
