/**
 * MessagesAPIAdapter Tests
 *
 * Test suite for /messages API pattern adapter (Anthropic Claude, XAI Grok)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MessagesAPIAdapter } from '../MessagesAPIAdapter';
import { CanonicalTool, CanonicalToolUse, CanonicalToolResult } from '../FormatAdapter.interface';
import { ModelConfig } from '../../models/ModelConfig.interface';

describe('MessagesAPIAdapter', () => {
  let adapter: MessagesAPIAdapter;
  let mockClaudeConfig: ModelConfig;
  let mockXAIConfig: ModelConfig;

  beforeEach(() => {
    adapter = new MessagesAPIAdapter();

    mockClaudeConfig = {
      id: 'claude-sonnet-4-5-20250929',
      provider: 'anthropic',
      displayName: 'Claude 3.5 Sonnet',
      family: 'claude-3-5',
      tools: {
        supported: true,
        adapter: 'MessagesAPIAdapter',
        namingConvention: 'snake_case',
        maxTools: 64,
        parallelToolCalls: true
      }
    } as ModelConfig;

    mockXAIConfig = {
      id: 'grok-beta',
      provider: 'xai',
      displayName: 'Grok Beta',
      family: 'grok',
      tools: {
        supported: true,
        adapter: 'MessagesAPIAdapter',
        namingConvention: 'snake_case',
        maxTools: 64,
        parallelToolCalls: true
      }
    } as ModelConfig;
  });

  describe('toProviderTools', () => {
    it('should convert canonical tool to Anthropic Tool format', () => {
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

      const result = adapter.toProviderTools([canonicalTool], mockClaudeConfig);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('name', 'read_file');
      expect(result[0]).toHaveProperty('description');
      expect(result[0]).toHaveProperty('input_schema');
      expect(result[0].input_schema.type).toBe('object');
    });

    it('should work with XAI config (Anthropic-compatible)', () => {
      const canonicalTool: CanonicalTool = {
        name: 'test_tool',
        description: 'Test tool for XAI',
        schema: {
          type: 'object',
          properties: {}
        }
      };

      const result = adapter.toProviderTools([canonicalTool], mockXAIConfig);

      expect(result[0]).toHaveProperty('input_schema');
      expect(result[0].name).toBe('test_tool');
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

      const result = adapter.toProviderTools([canonicalTool], mockClaudeConfig);

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

      const result = adapter.toProviderTools([canonicalTool], mockClaudeConfig);

      expect(result[0].input_schema.required).toEqual(['param1']);
    });
  });

  describe('fromProviderTools', () => {
    it('should convert Anthropic Tool to canonical format', () => {
      const anthropicTool = {
        name: 'read_file',
        description: 'Read a file',
        input_schema: {
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

      const result = adapter.fromProviderTools([anthropicTool], mockClaudeConfig);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('read_file');
      expect(result[0].description).toBe('Read a file');
      expect(result[0].schema.type).toBe('object');
      expect(result[0].metadata?.originalNaming).toBe('snake_case');
      expect(result[0].metadata?.sourceProvider).toBe('anthropic');
    });

    it('should handle XAI provider metadata', () => {
      const xaiTool = {
        name: 'test_tool',
        description: 'Test',
        input_schema: {
          type: 'object' as const,
          properties: {}
        }
      };

      const result = adapter.fromProviderTools([xaiTool], mockXAIConfig);

      expect(result[0].metadata?.sourceProvider).toBe('xai');
    });
  });

  describe('round-trip conversion', () => {
    it('should preserve tool data through round-trip conversion', () => {
      const originalTool: CanonicalTool = {
        name: 'complex_tool',
        description: 'A complex tool',
        schema: {
          type: 'object',
          properties: {
            string_param: {
              type: 'string',
              description: 'A string'
            },
            number_param: {
              type: 'number',
              description: 'A number'
            }
          },
          required: ['string_param']
        }
      };

      const anthropicTools = adapter.toProviderTools([originalTool], mockClaudeConfig);
      const backToCanonical = adapter.fromProviderTools(anthropicTools, mockClaudeConfig);

      expect(backToCanonical[0].name).toBe(originalTool.name);
      expect(backToCanonical[0].description).toBe(originalTool.description);
      expect(backToCanonical[0].schema.required).toEqual(originalTool.schema.required);
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

      const result = adapter.validateTool(validTool, mockClaudeConfig);

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

      const result = adapter.validateTool(tool, mockClaudeConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });
  });

  describe('tool use conversion', () => {
    it('should convert canonical tool use to Anthropic ToolUse', () => {
      const toolUse: CanonicalToolUse = {
        id: 'toolu_123',
        name: 'read_file',
        input: {
          file_path: '/path/to/file.txt'
        }
      };

      const result = adapter.toProviderToolUse(toolUse, mockClaudeConfig);

      expect(result.id).toBe('toolu_123');
      expect(result.type).toBe('tool_use');
      expect(result.name).toBe('read_file');
      expect(result.input).toEqual(toolUse.input);
    });

    it('should convert Anthropic ToolUse to canonical', () => {
      const anthropicToolUse = {
        id: 'toolu_456',
        type: 'tool_use' as const,
        name: 'write_file',
        input: {
          file_path: '/path/to/file.txt',
          content: 'Hello'
        }
      };

      const result = adapter.fromProviderToolUse(anthropicToolUse, mockClaudeConfig);

      expect(result.id).toBe('toolu_456');
      expect(result.name).toBe('write_file');
      expect(result.input).toEqual(anthropicToolUse.input);
      expect(result.metadata?.sourceProvider).toBe('anthropic');
    });
  });

  describe('tool result conversion', () => {
    it('should convert canonical tool result to Anthropic ToolResult', () => {
      const toolResult: CanonicalToolResult = {
        tool_use_id: 'toolu_123',
        content: 'File contents here',
        is_error: false
      };

      const result = adapter.toProviderToolResult(toolResult, mockClaudeConfig);

      expect(result.type).toBe('tool_result');
      expect(result.tool_use_id).toBe('toolu_123');
      expect(result.content).toBe('File contents here');
      expect(result.is_error).toBe(false);
    });

    it('should handle error tool results', () => {
      const errorResult: CanonicalToolResult = {
        tool_use_id: 'toolu_123',
        content: 'File not found',
        is_error: true
      };

      const result = adapter.toProviderToolResult(errorResult, mockClaudeConfig);

      expect(result.is_error).toBe(true);
      expect(result.content).toBe('File not found');
    });

    it('should convert structured content to JSON string', () => {
      const structuredResult: CanonicalToolResult = {
        tool_use_id: 'toolu_123',
        content: {
          status: 'success',
          data: { key: 'value' }
        }
      };

      const result = adapter.toProviderToolResult(structuredResult, mockClaudeConfig);

      expect(typeof result.content).toBe('string');
      expect(result.content).toContain('status');
      expect(result.content).toContain('success');
    });
  });

  describe('getMaxTools', () => {
    it('should return model config max tools', () => {
      const max = adapter.getMaxTools(mockClaudeConfig);
      expect(max).toBe(64);
    });
  });

  describe('supportsParallelToolCalls', () => {
    it('should return model config parallel support', () => {
      const supports = adapter.supportsParallelToolCalls(mockClaudeConfig);
      expect(supports).toBe(true);
    });
  });

  // ── #16 — Anthropic's signature requirement is split by thinking type ──
  // Extended thinking (Opus/Sonnet 4.5+): API requires `signature`.
  // Native interleaved (Haiku 4.5): API accepts signature-less.
  // Loss-of-signature can come from persistence / non-streaming paths;
  // dropping extended-source signature-less blocks prevents the 400
  // `messages.X.content.Y.thinking.signature: Field required`.
  describe('toProviderMessages — signature-less thinking handling (#16)', () => {
    it('drops EXTENDED-source thinking without signature when sending to Anthropic', () => {
      const canonicalMessage = {
        uuid: 'msg-1',
        timestamp: '2026-05-11T00:00:00Z',
        role: 'assistant' as const,
        content: [
          {
            type: 'thinking' as const,
            thinking: 'No signature here',
            thinkingMetadata: { source: 'extended' },
          } as any,
          { type: 'text' as const, text: 'visible response' },
        ],
        timeline: { sessionId: 's1', conversationId: 'c1', turnNumber: 1 },
      };

      const result = adapter.toProviderMessages([canonicalMessage as any], mockClaudeConfig);

      const types = (result[0]!.content as any[]).map((b) => b.type);
      expect(types).not.toContain('thinking');
      expect(types).toContain('text');
    });

    it('drops native-source thinking without signature too (#19 — Anthropic now rejects either way)', () => {
      // Originally the team's policy preserved signature-less native
      // interleaved thinking (Haiku 4.5). Live re-bench in round 12 showed
      // Anthropic 400s on signature-less thinking regardless of source.
      // Drop universally for Anthropic; losing reasoning context beats a
      // hard turn-stopping error.
      const canonicalMessage = {
        uuid: 'msg-1b',
        timestamp: '2026-05-11T00:00:00Z',
        role: 'assistant' as const,
        content: [
          {
            type: 'thinking' as const,
            thinking: 'Native interleaved reasoning',
            thinkingMetadata: { source: 'native' },
          } as any,
          { type: 'text' as const, text: 'visible response' },
        ],
        timeline: { sessionId: 's1', conversationId: 'c1', turnNumber: 1 },
      };

      const result = adapter.toProviderMessages([canonicalMessage as any], mockClaudeConfig);

      const thinking = (result[0]!.content as any[]).find((b) => b.type === 'thinking');
      expect(thinking).toBeUndefined();
      const text = (result[0]!.content as any[]).find((b) => b.type === 'text');
      expect(text).toBeDefined();
    });

    it('preserves thinking blocks WITH signature when sending to Anthropic', () => {
      const canonicalMessage = {
        uuid: 'msg-2',
        timestamp: '2026-05-11T00:00:00Z',
        role: 'assistant' as const,
        content: [
          { type: 'thinking' as const, thinking: 'reasoning', signature: 'sig_abc123' } as any,
          { type: 'text' as const, text: 'response' },
        ],
        timeline: { sessionId: 's1', conversationId: 'c1', turnNumber: 1 },
      };

      const result = adapter.toProviderMessages([canonicalMessage as any], mockClaudeConfig);

      const thinkingBlock = (result[0]!.content as any[]).find(
        (b) => b.type === 'thinking',
      );
      expect(thinkingBlock).toBeDefined();
      expect(thinkingBlock.signature).toBe('sig_abc123');
    });

    it('still passes signature-less thinking through to XAI (cache requires it)', () => {
      const canonicalMessage = {
        uuid: 'msg-3',
        timestamp: '2026-05-11T00:00:00Z',
        role: 'assistant' as const,
        content: [
          { type: 'thinking' as const, thinking: 'reasoning' },
          { type: 'text' as const, text: 'response' },
        ],
        timeline: { sessionId: 's1', conversationId: 'c1', turnNumber: 1 },
      };

      const result = adapter.toProviderMessages([canonicalMessage as any], mockXAIConfig);

      const thinkingBlock = (result[0]!.content as any[]).find(
        (b) => b.type === 'thinking',
      );
      // XAI tolerates signature-less thinking — preserve so the prompt cache
      // can still see the reasoning content (per docs.x.ai multi-turn rules).
      expect(thinkingBlock).toBeDefined();
      expect(thinkingBlock.thinking).toBe('reasoning');
    });
  });
});
