/**
 * Unit tests for mcp/edit command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mcpEdit } from '../../../../src/commands/mcp/edit.js';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

vi.mock('fs/promises', () => ({
  access: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('mcpEdit command', () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;
  let mockProcess: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((code) => {
      throw new Error(`process.exit(${code})`);
    }) as any);

    // Create a mock process that extends EventEmitter
    mockProcess = new EventEmitter();
    mockProcess.on = vi.fn((event: string, handler: any) => {
      if (event === 'exit') {
        // Simulate successful exit immediately
        setTimeout(() => handler(0), 0);
      }
      return mockProcess;
    });

    vi.mocked(spawn).mockReturnValue(mockProcess as any);
    vi.mocked(fs.access).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Success cases', () => {
    test('should open config file in default editor', async () => {
      const originalEditor = process.env.EDITOR;
      process.env.EDITOR = 'nano';

      await mcpEdit();

      expect(spawn).toHaveBeenCalled();
      const spawnCall = vi.mocked(spawn).mock.calls[0];
      expect(spawnCall[0]).toBe('nano');
      expect(spawnCall[1][0]).toContain('MCP_CONFIG.md');

      process.env.EDITOR = originalEditor;
    });

    test('should use specified editor option', async () => {
      await mcpEdit({ editor: 'vim' });

      expect(spawn).toHaveBeenCalled();
      const spawnCall = vi.mocked(spawn).mock.calls[0];
      expect(spawnCall[0]).toBe('vim');
    });

    test('should use custom file path', async () => {
      const originalEditor = process.env.EDITOR;
      process.env.EDITOR = 'nano';

      await mcpEdit({ file: '/custom/path/config.md' });

      expect(spawn).toHaveBeenCalled();
      const spawnCall = vi.mocked(spawn).mock.calls[0];
      expect(spawnCall[1][0]).toBe('/custom/path/config.md');

      process.env.EDITOR = originalEditor;
    });

    test('should use VISUAL env variable if EDITOR not set', async () => {
      const originalEditor = process.env.EDITOR;
      const originalVisual = process.env.VISUAL;
      delete process.env.EDITOR;
      process.env.VISUAL = 'emacs';

      await mcpEdit();

      expect(spawn).toHaveBeenCalled();
      const spawnCall = vi.mocked(spawn).mock.calls[0];
      expect(spawnCall[0]).toBe('emacs');

      process.env.EDITOR = originalEditor;
      process.env.VISUAL = originalVisual;
    });

    test('should use vi as fallback on Unix', async () => {
      const originalEditor = process.env.EDITOR;
      const originalVisual = process.env.VISUAL;
      const originalPlatform = process.platform;
      delete process.env.EDITOR;
      delete process.env.VISUAL;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      await mcpEdit();

      expect(spawn).toHaveBeenCalled();
      const spawnCall = vi.mocked(spawn).mock.calls[0];
      expect(spawnCall[0]).toBe('vi');

      process.env.EDITOR = originalEditor;
      process.env.VISUAL = originalVisual;
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('Error cases', () => {
    test('should handle missing config file', async () => {
      vi.mocked(fs.access).mockRejectedValue({ code: 'ENOENT' });

      await expect(mcpEdit()).rejects.toThrow('process.exit(1)');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      const calls = consoleErrorSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('not found'))).toBe(true);
    });
  });
});
