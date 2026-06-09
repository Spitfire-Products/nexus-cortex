/**
 * Unit tests for mcp/init command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mcpInit } from '../../../../src/commands/mcp/init.js';
import * as fs from 'fs/promises';

vi.mock('fs/promises', () => ({
  access: vi.fn(),
  writeFile: vi.fn(),
}));

describe('mcpInit command', () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

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
    test('should create MCP_CONFIG.md successfully', async () => {
      vi.mocked(fs.access).mockRejectedValueOnce({ code: 'ENOENT' } as any);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await mcpInit();

      expect(fs.writeFile).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('MCP configuration initialized'))).toBe(true);
    });

    test('should write config to current directory', async () => {
      vi.mocked(fs.access).mockRejectedValueOnce({ code: 'ENOENT' } as any);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await mcpInit();

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      expect(writeCall[0]).toContain('MCP_CONFIG.md');
      expect(writeCall[1]).toContain('MCP Server Configuration');
    });

    test('should include next steps in output', async () => {
      vi.mocked(fs.access).mockRejectedValueOnce({ code: 'ENOENT' } as any);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await mcpInit();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Next steps'))).toBe(true);
      expect(calls.some(c => c.includes('mcp validate'))).toBe(true);
    });
  });

  describe('File exists cases', () => {
    test('should error if file exists without --force', async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      try {
        await mcpInit();
      } catch (error: any) {
        // Process.exit threw an error as expected
        expect(error.message).toContain('process.exit(1)');
      }

      expect(processExitSpy).toHaveBeenCalledWith(1);
      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('already exists'))).toBe(true);
    });

    test('should overwrite file with --force flag', async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await mcpInit({ force: true });

      expect(fs.writeFile).toHaveBeenCalled();
      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('initialized'))).toBe(true);
    });
  });

  describe('Error cases', () => {
    test('should handle write errors', async () => {
      vi.mocked(fs.access).mockRejectedValueOnce({ code: 'ENOENT' } as any);
      vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error('Permission denied'));

      await expect(mcpInit()).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
