/**
 * MessagesAPIAdapter XAI Tool Validation Tests
 *
 * Tests XAI-specific tool validation and enhancement
 * Based on XAI API documentation requirements
 */

import { describe, it, expect } from 'vitest';
import { MessagesAPIAdapter } from '../MessagesAPIAdapter.js';
import { CanonicalTool } from '../FormatAdapter.interface.js';
import { ModelConfig } from '../../models/ModelConfig.interface.js';

describe('MessagesAPIAdapter - XAI Tool Validation', () => {
  const adapter = new MessagesAPIAdapter();

  // Mock XAI model config
  const xaiModelConfig: ModelConfig = {
    id: 'grok-code-fast-1',
    provider: 'xai',
    displayName: 'Grok Code Fast',
    family: 'grok-code',
    api: {
      pattern: 'messages',
      endpoint: 'https://api.x.ai/v1/messages',
      apiKeyEnvVar: 'XAI_API_KEY',
      authHeader: 'x-api-key',
      authPrefix: ''
    },
    context: { window: 256000, outputTokens: 131072 },
    pricing: { inputCost: 0.20, outputCost: 1.50 },
    tools: {
      supported: true,
      adapter: 'MessagesAPIAdapter',
      namingConvention: 'snake_case',
      maxTools: 128,
      parallelToolCalls: true
    },
    streaming: { supported: true }
  };

  // Mock Anthropic model config for comparison
  const anthropicModelConfig: ModelConfig = {
    ...xaiModelConfig,
    id: 'claude-sonnet-4-5-20250929',
    provider: 'anthropic',
    displayName: 'Claude 3.5 Sonnet'
  };

  describe('Tool Schema Enhancement for XAI', () => {
    it('should add description if missing for XAI tools', () => {
      const toolWithoutDescription: CanonicalTool = {
        name: 'test_tool',
        description: '', // Empty description
        schema: {
          type: 'object',
          properties: {
            param1: { type: 'string' }
          },
          required: []
        }
      };

      const result = adapter.toProviderTools([toolWithoutDescription], xaiModelConfig);

      expect(result[0].description).toBeDefined();
      expect(result[0].description).toBe('Execute test_tool tool');
    });

    it('should create default schema if missing for XAI tools', () => {
      const toolWithoutSchema: CanonicalTool = {
        name: 'test_tool',
        description: 'Test tool',
        schema: undefined as any // Missing schema
      };

      // Should not throw, should create default schema
      const result = adapter.toProviderTools([toolWithoutSchema], xaiModelConfig);

      expect(result[0].input_schema).toBeDefined();
      expect(result[0].input_schema.type).toBe('object');
      expect(result[0].input_schema.properties).toBeDefined();
      expect(result[0].input_schema.required).toBeDefined();
    });

    it('should add properties field if missing for XAI tools', () => {
      const toolWithoutProperties: CanonicalTool = {
        name: 'test_tool',
        description: 'Test tool',
        schema: {
          type: 'object',
          properties: undefined as any, // Missing properties
          required: []
        }
      };

      const result = adapter.toProviderTools([toolWithoutProperties], xaiModelConfig);

      expect(result[0].input_schema.properties).toBeDefined();
      expect(result[0].input_schema.properties).toEqual({});
    });

    it('should add required field if missing for XAI tools', () => {
      const toolWithoutRequired: CanonicalTool = {
        name: 'test_tool',
        description: 'Test tool',
        schema: {
          type: 'object',
          properties: {},
          required: undefined as any // Missing required
        }
      };

      const result = adapter.toProviderTools([toolWithoutRequired], xaiModelConfig);

      expect(result[0].input_schema.required).toBeDefined();
      expect(result[0].input_schema.required).toEqual([]);
    });

    it('should add property descriptions if missing for XAI tools', () => {
      const toolWithoutPropertyDescriptions: CanonicalTool = {
        name: 'test_tool',
        description: 'Test tool',
        schema: {
          type: 'object',
          properties: {
            param1: { type: 'string' }, // No description
            param2: { type: 'number' }  // No description
          },
          required: []
        }
      };

      const result = adapter.toProviderTools([toolWithoutPropertyDescriptions], xaiModelConfig);

      const param1 = result[0].input_schema.properties!['param1'] as any;
      const param2 = result[0].input_schema.properties!['param2'] as any;

      expect(param1.description).toBeDefined();
      expect(param1.description).toBe('Parameter param1 for test_tool');
      expect(param2.description).toBeDefined();
      expect(param2.description).toBe('Parameter param2 for test_tool');
    });

    it('should NOT modify Anthropic tools (only XAI)', () => {
      const toolWithoutDescription: CanonicalTool = {
        name: 'test_tool',
        description: '',
        schema: {
          type: 'object',
          properties: {},
          required: []
        }
      };

      const result = adapter.toProviderTools([toolWithoutDescription], anthropicModelConfig);

      // Should preserve empty description for Anthropic (not enhanced)
      expect(result[0].description).toBe('');
    });

    it('should handle complete XAI-compliant tool without modification', () => {
      const compliantTool: CanonicalTool = {
        name: 'web_search',
        description: 'Search the web for information',
        schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query to execute'
            }
          },
          required: ['query']
        }
      };

      const result = adapter.toProviderTools([compliantTool], xaiModelConfig);

      expect(result[0].name).toBe('web_search');
      expect(result[0].description).toBe('Search the web for information');
      expect(result[0].input_schema.properties!['query']).toEqual({
        type: 'string',
        description: 'Search query to execute'
      });
      expect(result[0].input_schema.required).toEqual(['query']);
    });
  });

  describe('Tool Use Response Validation', () => {
    it('should throw error if tool_use missing "id" field', () => {
      const malformedToolUse = {
        // id missing
        type: 'tool_use',
        name: 'test_tool',
        input: {}
      };

      expect(() => {
        adapter.fromProviderToolUse(malformedToolUse, xaiModelConfig);
      }).toThrow('missing required "id" field');
    });

    it('should throw error if tool_use missing "name" field', () => {
      const malformedToolUse = {
        id: 'call_123',
        type: 'tool_use',
        // name missing (undefined)
        input: {}
      };

      expect(() => {
        adapter.fromProviderToolUse(malformedToolUse, xaiModelConfig);
      }).toThrow('missing required "name" field');
    });

    it('should handle valid tool_use block', () => {
      const validToolUse = {
        id: 'call_123',
        type: 'tool_use',
        name: 'web_search',
        input: { query: 'test query' }
      };

      const result = adapter.fromProviderToolUse(validToolUse, xaiModelConfig);

      expect(result.id).toBe('call_123');
      expect(result.name).toBe('web_search');
      expect(result.input).toEqual({ query: 'test query' });
      expect(result.metadata.sourceProvider).toBe('xai');
    });

    it('should provide empty object for missing input', () => {
      const toolUseWithoutInput = {
        id: 'call_123',
        type: 'tool_use',
        name: 'test_tool'
        // input missing
      };

      const result = adapter.fromProviderToolUse(toolUseWithoutInput, xaiModelConfig);

      expect(result.input).toEqual({});
    });
  });

  describe('XAI API Format Compliance', () => {
    it('should produce XAI-compliant tool format', () => {
      const tool: CanonicalTool = {
        name: 'read_file',
        description: 'Read file contents',
        schema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to file'
            }
          },
          required: ['file_path']
        }
      };

      const result = adapter.toProviderTools([tool], xaiModelConfig);

      // Verify XAI API requirements
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('description');
      expect(result[0]).toHaveProperty('input_schema');
      expect(result[0].input_schema).toHaveProperty('type');
      expect(result[0].input_schema).toHaveProperty('properties');
      expect(result[0].input_schema).toHaveProperty('required');

      // Verify all fields are non-empty/non-null
      expect(result[0].name).toBeTruthy();
      expect(result[0].description).toBeTruthy();
      expect(result[0].input_schema.type).toBe('object');
      expect(result[0].input_schema.properties).toBeDefined();
      expect(result[0].input_schema.required).toBeDefined();
    });
  });
});
