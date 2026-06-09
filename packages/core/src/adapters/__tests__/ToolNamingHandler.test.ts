/**
 * ToolNamingHandler Test Suite
 *
 * Tests the gateway-level tool naming convention handler.
 *
 * Architecture principle: Gateway handles naming, adapters handle format.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolNamingHandler } from '../ToolNamingHandler';
import { CanonicalTool, CanonicalToolUse, CanonicalToolResult } from '../FormatAdapter.interface';

describe('ToolNamingHandler', () => {
  let handler: ToolNamingHandler;

  beforeEach(() => {
    handler = new ToolNamingHandler();
  });

  describe('applyNamingConvention', () => {
    const tools: CanonicalTool[] = [
      {
        name: 'read_file',
        description: 'Read file contents',
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string' }
          },
          required: ['path']
        }
      },
      {
        name: 'WriteFile',
        description: 'Write file contents',
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' }
          },
          required: ['path', 'content']
        }
      }
    ];

    it('should convert to snake_case', () => {
      const result = handler.applyNamingConvention(tools, 'snake_case');

      expect(result[0].name).toBe('read_file'); // Already snake_case
      expect(result[1].name).toBe('write_file'); // Converted from PascalCase
    });

    it('should convert to PascalCase', () => {
      const result = handler.applyNamingConvention(tools, 'PascalCase');

      expect(result[0].name).toBe('ReadFile'); // Converted from snake_case
      expect(result[1].name).toBe('WriteFile'); // Already PascalCase
    });

    it('should handle camelCase input', () => {
      const camelTools: CanonicalTool[] = [{
        name: 'readFileContents',
        description: 'Read file',
        schema: { type: 'object', properties: {}, required: [] }
      }];

      const snakeResult = handler.applyNamingConvention(camelTools, 'snake_case');
      expect(snakeResult[0].name).toBe('read_file_contents');

      const pascalResult = handler.applyNamingConvention(camelTools, 'PascalCase');
      expect(pascalResult[0].name).toBe('ReadFileContents');
    });

    it('should handle already correct naming', () => {
      const snakeTools: CanonicalTool[] = [{
        name: 'already_snake_case',
        description: 'Test',
        schema: { type: 'object', properties: {}, required: [] }
      }];

      const result = handler.applyNamingConvention(snakeTools, 'snake_case');
      expect(result[0].name).toBe('already_snake_case');
    });

    it('should preserve other tool properties', () => {
      const result = handler.applyNamingConvention(tools, 'snake_case');

      expect(result[0].description).toBe('Read file contents');
      expect(result[0].schema).toEqual(tools[0].schema);
      expect(result[1].description).toBe('Write file contents');
      expect(result[1].schema).toEqual(tools[1].schema);
    });
  });

  describe('applyNamingToToolUse', () => {
    it('should convert tool use name to snake_case', () => {
      const toolUse: CanonicalToolUse = {
        id: 'tool-123',
        name: 'ReadFile',
        input: { path: '/test.txt' }
      };

      const result = handler.applyNamingToToolUse(toolUse, 'snake_case');
      expect(result.name).toBe('read_file');
      expect(result.id).toBe('tool-123');
      expect(result.input).toEqual({ path: '/test.txt' });
    });

    it('should convert tool use name to PascalCase', () => {
      const toolUse: CanonicalToolUse = {
        id: 'tool-456',
        name: 'write_file',
        input: { path: '/test.txt', content: 'data' }
      };

      const result = handler.applyNamingToToolUse(toolUse, 'PascalCase');
      expect(result.name).toBe('WriteFile');
      expect(result.id).toBe('tool-456');
      expect(result.input).toEqual({ path: '/test.txt', content: 'data' });
    });
  });

  describe('applyNamingToToolResult', () => {
    it('should return tool result unchanged', () => {
      const toolResult: CanonicalToolResult = {
        tool_use_id: 'tool-123',
        content: 'File contents',
        is_error: false
      };

      const snakeResult = handler.applyNamingToToolResult(toolResult, 'snake_case');
      expect(snakeResult).toEqual(toolResult);

      const pascalResult = handler.applyNamingToToolResult(toolResult, 'PascalCase');
      expect(pascalResult).toEqual(toolResult);
    });
  });

  describe('validateNaming', () => {
    it('should validate snake_case naming', () => {
      const validTools: CanonicalTool[] = [
        {
          name: 'read_file',
          description: 'Test',
          schema: { type: 'object', properties: {}, required: [] }
        },
        {
          name: 'write_file_contents',
          description: 'Test',
          schema: { type: 'object', properties: {}, required: [] }
        }
      ];

      const result = handler.validateNaming(validTools, 'snake_case');
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should detect invalid snake_case naming', () => {
      const invalidTools: CanonicalTool[] = [
        {
          name: 'ReadFile',
          description: 'Test',
          schema: { type: 'object', properties: {}, required: [] }
        },
        {
          name: 'writeFile',
          description: 'Test',
          schema: { type: 'object', properties: {}, required: [] }
        }
      ];

      const result = handler.validateNaming(invalidTools, 'snake_case');
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors![0]).toContain('ReadFile');
      expect(result.errors![1]).toContain('writeFile');
    });

    it('should validate PascalCase naming', () => {
      const validTools: CanonicalTool[] = [
        {
          name: 'ReadFile',
          description: 'Test',
          schema: { type: 'object', properties: {}, required: [] }
        },
        {
          name: 'WriteFileContents',
          description: 'Test',
          schema: { type: 'object', properties: {}, required: [] }
        }
      ];

      const result = handler.validateNaming(validTools, 'PascalCase');
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should detect invalid PascalCase naming', () => {
      const invalidTools: CanonicalTool[] = [
        {
          name: 'read_file',
          description: 'Test',
          schema: { type: 'object', properties: {}, required: [] }
        },
        {
          name: 'writeFile',
          description: 'Test',
          schema: { type: 'object', properties: {}, required: [] }
        }
      ];

      const result = handler.validateNaming(invalidTools, 'PascalCase');
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors![0]).toContain('read_file');
      expect(result.errors![1]).toContain('writeFile');
    });
  });

  describe('detectConvention', () => {
    it('should detect snake_case', () => {
      expect(handler.detectConvention('read_file')).toBe('snake_case');
      expect(handler.detectConvention('write_file_contents')).toBe('snake_case');
      expect(handler.detectConvention('a_b_c')).toBe('snake_case');
    });

    it('should detect PascalCase', () => {
      expect(handler.detectConvention('ReadFile')).toBe('PascalCase');
      expect(handler.detectConvention('WriteFileContents')).toBe('PascalCase');
      expect(handler.detectConvention('ABC')).toBe('PascalCase');
    });

    it('should detect camelCase', () => {
      expect(handler.detectConvention('readFile')).toBe('camelCase');
      expect(handler.detectConvention('writeFileContents')).toBe('camelCase');
      expect(handler.detectConvention('aBC')).toBe('camelCase');
    });

    it('should detect unknown conventions', () => {
      expect(handler.detectConvention('read-file')).toBe('unknown');
      expect(handler.detectConvention('READ_FILE')).toBe('unknown');
      expect(handler.detectConvention('123invalid')).toBe('unknown');
    });
  });

  describe('edge cases', () => {
    it('should handle empty tool arrays', () => {
      const result = handler.applyNamingConvention([], 'snake_case');
      expect(result).toEqual([]);
    });

    it('should handle single character names', () => {
      const tools: CanonicalTool[] = [{
        name: 'x',
        description: 'Test',
        schema: { type: 'object', properties: {}, required: [] }
      }];

      const snakeResult = handler.applyNamingConvention(tools, 'snake_case');
      expect(snakeResult[0].name).toBe('x');

      const pascalResult = handler.applyNamingConvention(tools, 'PascalCase');
      expect(pascalResult[0].name).toBe('X');
    });

    it('should handle names with numbers', () => {
      const tools: CanonicalTool[] = [{
        name: 'read_file_v2',
        description: 'Test',
        schema: { type: 'object', properties: {}, required: [] }
      }];

      const pascalResult = handler.applyNamingConvention(tools, 'PascalCase');
      expect(pascalResult[0].name).toBe('ReadFileV2');
    });

    it('should handle consecutive underscores', () => {
      const tools: CanonicalTool[] = [{
        name: 'read__file',
        description: 'Test',
        schema: { type: 'object', properties: {}, required: [] }
      }];

      const pascalResult = handler.applyNamingConvention(tools, 'PascalCase');
      expect(pascalResult[0].name).toBe('ReadFile');
    });
  });

  // ── MCP-prefixed names must survive conversion verbatim ──────────────────
  // (Regression for deficiency #14 — surfaced by bench 4 where the model
  //  saw `Nexus-browserBrowse` because case conversion mangled the prefix.)
  describe('MCP namespaced tool names round-trip verbatim', () => {
    it('preserves <server>__<tool> through PascalCase conversion', () => {
      const tools: CanonicalTool[] = [{
        name: 'nexus-browser__browse',
        description: 'MCP tool',
        schema: { type: 'object', properties: {}, required: [] },
      }];
      const result = handler.applyNamingConvention(tools, 'PascalCase');
      expect(result[0].name).toBe('nexus-browser__browse');
    });

    it('preserves <server>__<tool> through snake_case conversion', () => {
      const tools: CanonicalTool[] = [{
        name: 'nexus-browser__browse',
        description: 'MCP tool',
        schema: { type: 'object', properties: {}, required: [] },
      }];
      const result = handler.applyNamingConvention(tools, 'snake_case');
      expect(result[0].name).toBe('nexus-browser__browse');
    });

    it('preserves names with hyphens AND underscores in the tool half', () => {
      const tools: CanonicalTool[] = [{
        name: 'nexus-browser__wait_for_challenge_resolution',
        description: 'MCP tool',
        schema: { type: 'object', properties: {}, required: [] },
      }];
      const pascal = handler.applyNamingConvention(tools, 'PascalCase');
      const snake = handler.applyNamingConvention(tools, 'snake_case');
      expect(pascal[0].name).toBe('nexus-browser__wait_for_challenge_resolution');
      expect(snake[0].name).toBe('nexus-browser__wait_for_challenge_resolution');
    });
  });
});