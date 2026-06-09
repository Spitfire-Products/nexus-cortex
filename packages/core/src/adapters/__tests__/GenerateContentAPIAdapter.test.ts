/**
 * GenerateContentAPIAdapter Tests
 *
 * Test suite for generateContent API pattern adapter (Google Gemini/Vertex AI)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GenerateContentAPIAdapter } from '../GenerateContentAPIAdapter';
import { CanonicalTool, CanonicalToolUse, CanonicalToolResult } from '../FormatAdapter.interface';
import { ModelConfig } from '../../models/ModelConfig.interface';

describe('GenerateContentAPIAdapter', () => {
  let adapter: GenerateContentAPIAdapter;
  let mockGeminiConfig: ModelConfig;

  beforeEach(() => {
    adapter = new GenerateContentAPIAdapter();

    mockGeminiConfig = {
      id: 'gemini-2.0-flash-exp',
      provider: 'google',
      displayName: 'Gemini 2.0 Flash',
      family: 'gemini-2.0',
      tools: {
        supported: true,
        adapter: 'GenerateContentAPIAdapter',
        namingConvention: 'snake_case',
        maxTools: 9999,
        parallelToolCalls: false
      }
    } as ModelConfig;
  });

  describe('toProviderTools', () => {
    it('should convert canonical tool to Gemini FunctionDeclaration format', () => {
      const canonicalTool: CanonicalTool = {
        name: 'read_file',
        description: 'Read a file from the filesystem',
        schema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file'
            }
          },
          required: ['file_path']
        }
      };

      const result = adapter.toProviderTools([canonicalTool], mockGeminiConfig);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('name', 'read_file');
      expect(result[0]).toHaveProperty('description');
      expect(result[0]).toHaveProperty('parameters');
      expect(result[0].parameters.type).toBe('object');
    });

    it('should pass through tool names unchanged (gateway handles naming)', () => {
      // Gateway has already converted to snake_case
      const canonicalTool: CanonicalTool = {
        name: 'read_file', // Already snake_case from gateway
        description: 'Read a file',
        schema: {
          type: 'object',
          properties: {}
        }
      };

      const result = adapter.toProviderTools([canonicalTool], mockGeminiConfig);

      expect(result[0].name).toBe('read_file');
    });

    it('should preserve required fields', () => {
      const canonicalTool: CanonicalTool = {
        name: 'test_tool',
        description: 'Test tool',
        schema: {
          type: 'object',
          properties: {
            param1: { type: 'string' },
            param2: { type: 'number' }
          },
          required: ['param1']
        }
      };

      const result = adapter.toProviderTools([canonicalTool], mockGeminiConfig);

      expect(result[0].parameters.required).toEqual(['param1']);
    });
  });

  describe('fromProviderTools', () => {
    it('should convert Gemini FunctionDeclaration to canonical format', () => {
      const geminiTool = {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object' as const,
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to file'
            }
          },
          required: ['file_path']
        }
      };

      const result = adapter.fromProviderTools([geminiTool], mockGeminiConfig);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('read_file');
      expect(result[0].description).toBe('Read a file');
      expect(result[0].schema.type).toBe('object');
      expect(result[0].schema.properties).toBeDefined();
      expect(result[0].metadata?.originalName).toBe('read_file');
    });
  });

  describe('round-trip conversion', () => {
    it('should preserve tool data through round-trip conversion', () => {
      const originalTool: CanonicalTool = {
        name: 'complex_tool',
        description: 'A complex tool with multiple parameters',
        schema: {
          type: 'object',
          properties: {
            string_param: {
              type: 'string',
              description: 'A string parameter'
            },
            number_param: {
              type: 'number',
              description: 'A number parameter'
            },
            boolean_param: {
              type: 'boolean',
              description: 'A boolean parameter'
            }
          },
          required: ['string_param', 'number_param']
        }
      };

      // Convert to Gemini format
      const geminiTools = adapter.toProviderTools([originalTool], mockGeminiConfig);

      // Convert back to canonical
      const backToCanonical = adapter.fromProviderTools(geminiTools, mockGeminiConfig);

      expect(backToCanonical[0].name).toBe(originalTool.name);
      expect(backToCanonical[0].description).toBe(originalTool.description);
      expect(backToCanonical[0].schema.required).toEqual(originalTool.schema.required);
      expect(Object.keys(backToCanonical[0].schema.properties)).toEqual(
        Object.keys(originalTool.schema.properties)
      );
    });
  });

  describe('validateTool', () => {
    it('should validate snake_case tool names', () => {
      const validTool: CanonicalTool = {
        name: 'valid_tool_name',
        description: 'Valid tool',
        schema: {
          type: 'object',
          properties: {}
        }
      };

      const result = adapter.validateTool(validTool, mockGeminiConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should accept any tool names (gateway handles naming validation)', () => {
      // Gateway is responsible for naming validation now
      const tool: CanonicalTool = {
        name: 'any_name_works', // Gateway ensures correct naming
        description: 'Tool with pre-validated name',
        schema: {
          type: 'object',
          properties: {}
        }
      };

      const result = adapter.validateTool(tool, mockGeminiConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should require description', () => {
      const noDescTool: CanonicalTool = {
        name: 'test_tool',
        description: '',
        schema: {
          type: 'object',
          properties: {}
        }
      };

      const result = adapter.validateTool(noDescTool, mockGeminiConfig);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should require object schema type', () => {
      const invalidSchema: CanonicalTool = {
        name: 'test_tool',
        description: 'Test',
        schema: {
          type: 'string' as any,
          properties: {}
        }
      };

      const result = adapter.validateTool(invalidSchema, mockGeminiConfig);

      expect(result.valid).toBe(false);
    });
  });

  describe('tool use conversion', () => {
    it('should convert canonical tool use to Gemini FunctionCall', () => {
      const toolUse: CanonicalToolUse = {
        id: 'toolu_123',
        name: 'read_file',
        input: {
          file_path: '/path/to/file.txt'
        }
      };

      const result = adapter.toProviderToolUse(toolUse, mockGeminiConfig);

      expect(result.name).toBe('read_file');
      expect(result.args).toEqual(toolUse.input);
    });

    it('should pass through tool names unchanged in tool use (gateway handles naming)', () => {
      // Gateway has already converted to snake_case
      const toolUse: CanonicalToolUse = {
        id: 'toolu_123',
        name: 'read_file', // Already snake_case from gateway
        input: {
          file_path: '/path/to/file.txt'
        }
      };

      const result = adapter.toProviderToolUse(toolUse, mockGeminiConfig);

      expect(result.name).toBe('read_file');
    });
  });

  describe('getMaxTools', () => {
    it('should return model config max tools', () => {
      const max = adapter.getMaxTools(mockGeminiConfig);
      expect(max).toBe(9999);
    });
  });

  describe('supportsParallelToolCalls', () => {
    it('should return model config parallel support', () => {
      const supports = adapter.supportsParallelToolCalls(mockGeminiConfig);
      expect(supports).toBe(false);
    });
  });

  // #23 (2026-05-11) — Gemini 2.5+/3 multi-turn requires `thoughtSignature`
  // to be threaded through `functionCall` parts on continuation. The
  // per-block adapter (fromProviderToolUse / toProviderToolUse) does
  // preserve it, but the MESSAGE-level converter previously dropped it,
  // breaking the round-trip. Surfaced by round-14's adapter round-trip
  // audit (cross-confirmed by Opus 4.6 sub-agent + cortex/claude-opus-4-6).
  describe('thoughtSignature round-trip on message-level conversion (#23)', () => {
    const configWithApi: any = {
      ...{ id: 'gemini-2.5-pro', provider: 'google', displayName: 'Gemini 2.5', family: 'gemini-2.5',
           tools: { supported: true, adapter: 'GenerateContentAPIAdapter', namingConvention: 'snake_case', maxTools: 9999, parallelToolCalls: false } },
      api: { pattern: 'generateContent' },
    };

    it('preserves thoughtSignature from provider message into canonical tool_use metadata', () => {
      const providerMessage: any = {
        role: 'model',
        parts: [
          {
            functionCall: { name: 'read_file', args: { path: '/tmp/x' } },
            thoughtSignature: 'thought_sig_abc123',
          },
        ],
      };

      const sessionContext = { sessionId: 's1', conversationId: 'c1', turnNumber: 1 };
      const result = adapter.fromProviderMessages([providerMessage], configWithApi, sessionContext);

      expect(result).toHaveLength(1);
      const toolUseBlock = result[0]!.content.find((b: any) => b.type === 'tool_use') as any;
      expect(toolUseBlock).toBeDefined();
      expect(toolUseBlock.toolUse.metadata?.thoughtSignature).toBe('thought_sig_abc123');
    });

    it('round-trips thoughtSignature through to_provider after from_provider', () => {
      // Simulate the real loop: provider response → canonical → re-send.
      const providerMessage: any = {
        role: 'model',
        parts: [
          {
            functionCall: { name: 'do_something', args: { x: 1 } },
            thoughtSignature: 'sig_round_trip',
          },
        ],
      };
      const sessionContext = { sessionId: 's1', conversationId: 'c1', turnNumber: 1 };
      const canonical = adapter.fromProviderMessages([providerMessage], configWithApi, sessionContext);
      const reSent = adapter.toProviderMessages(canonical, configWithApi);

      const fnCallPart = (reSent[0]!.parts as any[]).find((p) => p.functionCall);
      expect(fnCallPart).toBeDefined();
      expect(fnCallPart.thoughtSignature).toBe('sig_round_trip');
    });
  });
});
