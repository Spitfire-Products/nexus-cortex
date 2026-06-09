/**
 * ChatCompletionsAPIAdapter Tests
 *
 * Test suite for /v1/chat/completions API pattern adapter (OpenAI, DeepSeek, Groq, etc.)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChatCompletionsAPIAdapter } from '../ChatCompletionsAPIAdapter';
import { CanonicalTool, CanonicalToolUse, CanonicalToolResult } from '../FormatAdapter.interface';
import { ModelConfig } from '../../models/ModelConfig.interface';

describe('ChatCompletionsAPIAdapter', () => {
  let adapter: ChatCompletionsAPIAdapter;
  let mockOpenAIConfig: ModelConfig;
  let mockDeepSeekConfig: ModelConfig;

  beforeEach(() => {
    adapter = new ChatCompletionsAPIAdapter();

    mockOpenAIConfig = {
      id: 'gpt-4',
      provider: 'openai',
      displayName: 'GPT-4',
      family: 'gpt-4',
      tools: {
        supported: true,
        adapter: 'ChatCompletionsAPIAdapter',
        namingConvention: 'PascalCase',
        maxTools: 128,
        parallelToolCalls: true
      }
    } as ModelConfig;

    mockDeepSeekConfig = {
      id: 'deepseek-chat',
      provider: 'deepseek',
      displayName: 'DeepSeek Chat',
      family: 'deepseek',
      tools: {
        supported: true,
        adapter: 'ChatCompletionsAPIAdapter',
        namingConvention: 'snake_case',
        maxTools: 128,
        parallelToolCalls: true
      }
    } as ModelConfig;
  });

  describe('toProviderTools', () => {
    it('should convert canonical tool to OpenAI ChatCompletionTool format', () => {
      const canonicalTool: CanonicalTool = {
        name: 'ReadFile',
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

      const result = adapter.toProviderTools([canonicalTool], mockOpenAIConfig);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('function');
      expect(result[0].function).toHaveProperty('name', 'ReadFile');
      expect(result[0].function).toHaveProperty('description');
      expect(result[0].function).toHaveProperty('parameters');
      expect(result[0].function.parameters.type).toBe('object');
    });

    it('should pass through tool names unchanged (gateway handles PascalCase)', () => {
      // Gateway has already converted to PascalCase for OpenAI
      const canonicalTool: CanonicalTool = {
        name: 'ReadFile', // Already PascalCase from gateway
        description: 'Read a file',
        schema: {
          type: 'object',
          properties: {}
        }
      };

      const result = adapter.toProviderTools([canonicalTool], mockOpenAIConfig);

      expect(result[0].function.name).toBe('ReadFile');
    });

    it('should pass through tool names unchanged (gateway handles snake_case)', () => {
      // Gateway has already converted to snake_case for DeepSeek
      const canonicalTool: CanonicalTool = {
        name: 'read_file', // Already snake_case from gateway
        description: 'Read a file',
        schema: {
          type: 'object',
          properties: {}
        }
      };

      const result = adapter.toProviderTools([canonicalTool], mockDeepSeekConfig);

      expect(result[0].function.name).toBe('read_file');
    });

    it('should preserve required fields', () => {
      const canonicalTool: CanonicalTool = {
        name: 'TestTool',
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

      const result = adapter.toProviderTools([canonicalTool], mockOpenAIConfig);

      expect(result[0].function.parameters.required).toEqual(['param1']);
    });
  });

  describe('fromProviderTools', () => {
    it('should convert OpenAI ChatCompletionTool to canonical format', () => {
      const openaiTool = {
        type: 'function' as const,
        function: {
          name: 'ReadFile',
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
        }
      };

      const result = adapter.fromProviderTools([openaiTool], mockOpenAIConfig);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('ReadFile');
      expect(result[0].description).toBe('Read a file');
      expect(result[0].schema.type).toBe('object');
      expect(result[0].metadata?.originalName).toBe('ReadFile');
    });
  });

  describe('round-trip conversion', () => {
    it('should preserve tool data through round-trip conversion (PascalCase)', () => {
      const originalTool: CanonicalTool = {
        name: 'ComplexTool',
        description: 'A complex tool',
        schema: {
          type: 'object',
          properties: {
            stringParam: {
              type: 'string',
              description: 'A string'
            },
            numberParam: {
              type: 'number',
              description: 'A number'
            }
          },
          required: ['stringParam']
        }
      };

      const openaiTools = adapter.toProviderTools([originalTool], mockOpenAIConfig);
      const backToCanonical = adapter.fromProviderTools(openaiTools, mockOpenAIConfig);

      expect(backToCanonical[0].name).toBe(originalTool.name);
      expect(backToCanonical[0].description).toBe(originalTool.description);
    });

    it('should preserve tool data through round-trip conversion (snake_case)', () => {
      const originalTool: CanonicalTool = {
        name: 'complex_tool',
        description: 'A complex tool',
        schema: {
          type: 'object',
          properties: {
            string_param: {
              type: 'string'
            }
          },
          required: ['string_param']
        }
      };

      const openaiTools = adapter.toProviderTools([originalTool], mockDeepSeekConfig);
      const backToCanonical = adapter.fromProviderTools(openaiTools, mockDeepSeekConfig);

      expect(backToCanonical[0].name).toBe(originalTool.name);
    });
  });

  describe('validateTool', () => {
    it('should accept any tool names (gateway handles naming validation)', () => {
      const validTool: CanonicalTool = {
        name: 'ValidToolName', // Gateway ensures correct naming
        description: 'Valid tool',
        schema: {
          type: 'object',
          properties: {}
        }
      };

      const result = adapter.validateTool(validTool, mockOpenAIConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should validate schema structure, not naming', () => {
      const validTool: CanonicalTool = {
        name: 'any_name', // Gateway handles naming
        description: 'Valid tool',
        schema: {
          type: 'object',
          properties: {}
        }
      };

      const result = adapter.validateTool(validTool, mockDeepSeekConfig);

      expect(result.valid).toBe(true);
    });

    it('should reject non-object schema types', () => {
      const invalidTool: CanonicalTool = {
        name: 'tool_name',
        description: 'Invalid tool',
        schema: {
          type: 'array' as any, // Wrong type
          properties: {}
        }
      };

      const result = adapter.validateTool(invalidTool, mockOpenAIConfig);

      expect(result.valid).toBe(false);
      expect(result.errors![0]).toContain('object');
    });
  });

  describe('tool use conversion', () => {
    it('should convert canonical tool use to OpenAI ToolCall', () => {
      const toolUse: CanonicalToolUse = {
        id: 'call_abc123',
        name: 'ReadFile',
        input: {
          file_path: '/path/to/file.txt'
        }
      };

      const result = adapter.toProviderToolUse(toolUse, mockOpenAIConfig);

      expect(result.id).toBe('call_abc123');
      expect(result.type).toBe('function');
      expect(result.function.name).toBe('ReadFile');
      expect(JSON.parse(result.function.arguments)).toEqual(toolUse.input);
    });

    it('should convert OpenAI ToolCall to canonical', () => {
      const openaiToolCall = {
        id: 'call_def456',
        type: 'function' as const,
        function: {
          name: 'WriteFile',
          arguments: JSON.stringify({
            file_path: '/path/to/file.txt',
            content: 'Hello'
          })
        }
      };

      const result = adapter.fromProviderToolUse(openaiToolCall, mockOpenAIConfig);

      expect(result.id).toBe('call_def456');
      expect(result.name).toBe('WriteFile');
      expect(result.input).toEqual({
        file_path: '/path/to/file.txt',
        content: 'Hello'
      });
    });

    it('should handle invalid JSON arguments gracefully', () => {
      const invalidToolCall = {
        id: 'call_bad',
        type: 'function' as const,
        function: {
          name: 'TestTool',
          arguments: 'invalid json {'
        }
      };

      const result = adapter.fromProviderToolUse(invalidToolCall, mockOpenAIConfig);

      expect(result.input).toEqual({});
    });
  });

  describe('tool result conversion', () => {
    it('should convert canonical tool result to OpenAI ToolMessage', () => {
      const toolResult: CanonicalToolResult = {
        tool_use_id: 'call_123',
        content: 'File contents here'
      };

      const result = adapter.toProviderToolResult(toolResult, mockOpenAIConfig);

      expect(result.role).toBe('tool');
      expect(result.tool_call_id).toBe('call_123');
      expect(result.content).toBe('File contents here');
    });

    it('should handle error tool results', () => {
      const errorResult: CanonicalToolResult = {
        tool_use_id: 'call_123',
        content: 'File not found',
        is_error: true
      };

      const result = adapter.toProviderToolResult(errorResult, mockOpenAIConfig);

      expect(result.content).toContain('ERROR:');
      expect(result.content).toContain('File not found');
    });

    it('should convert structured content to JSON string', () => {
      const structuredResult: CanonicalToolResult = {
        tool_use_id: 'call_123',
        content: {
          status: 'success',
          data: { key: 'value' }
        }
      };

      const result = adapter.toProviderToolResult(structuredResult, mockOpenAIConfig);

      expect(typeof result.content).toBe('string');
      expect(result.content).toContain('status');
    });
  });

  describe('getMaxTools', () => {
    it('should return model config max tools', () => {
      const max = adapter.getMaxTools(mockOpenAIConfig);
      expect(max).toBe(128);
    });
  });

  describe('supportsParallelToolCalls', () => {
    it('should return model config parallel support', () => {
      const supports = adapter.supportsParallelToolCalls(mockOpenAIConfig);
      expect(supports).toBe(true);
    });
  });
});
