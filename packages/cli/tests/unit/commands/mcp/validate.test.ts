/**
 * Unit tests for mcp/validate command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mcpValidate } from '../../../../src/commands/mcp/validate.js';
import * as fs from 'fs/promises';

vi.mock('fs/promises');

describe('mcpValidate command', () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const validConfig = `# MCP Config

\`\`\`json
{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem"],
  "description": "File access"
}
\`\`\`
`;

  const invalidConfig = `# MCP Config

\`\`\`json
{
  "name": "filesystem",
  "args": "not-an-array"
}
\`\`\`
`;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((code) => {
      throw new Error(`process.exit(${code})`);
    }) as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Success cases', () => {
    test('should validate correct configuration', async () => {
      (fs.readFile as any) = vi.fn().mockResolvedValue(validConfig);

      await mcpValidate();

      expect(consoleLogSpy).toHaveBeenCalled();
      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Configuration is valid'))).toBe(true);
    });

    test('should show configured servers', async () => {
      (fs.readFile as any) = vi.fn().mockResolvedValue(validConfig);

      await mcpValidate();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('filesystem'))).toBe(true);
    });
  });

  describe('Validation errors', () => {
    test('should detect missing required fields', async () => {
      (fs.readFile as any) = vi.fn().mockResolvedValue(invalidConfig);

      await expect(mcpValidate()).rejects.toThrow('process.exit(1)');

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Validation failed'))).toBe(true);
    });

    test('should detect invalid JSON', async () => {
      const badJson = '```json\n{invalid json\n```';
      (fs.readFile as any) = vi.fn().mockResolvedValue(badJson);

      await expect(mcpValidate()).rejects.toThrow('process.exit(1)');

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Invalid JSON'))).toBe(true);
    });
  });

  describe('Error cases', () => {
    test('should handle missing config file', async () => {
      (fs.readFile as any) = vi.fn().mockRejectedValue({ code: 'ENOENT' });

      await expect(mcpValidate()).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const calls = consoleErrorSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('not found'))).toBe(true);
    });
  });
});
