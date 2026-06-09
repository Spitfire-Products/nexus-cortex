/**
 * Unit tests for mcp/enable command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mcpEnable } from '../../../../src/commands/mcp/enable.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

vi.mock('../../../../src/client/CortexClient.js', () => ({
  CortexClient: vi.fn()
}));

describe('mcpEnable command', () => {
  let mockPost: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockSuccessResponse = {
    success: true,
    message: 'Enabled postgres server'
  };

  beforeEach(() => {
    mockPost = vi.fn().mockResolvedValue(mockSuccessResponse);
    (CortexClient as any).mockImplementation(() => ({ post: mockPost }));

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
    test('should enable MCP server successfully', async () => {
      await mcpEnable('postgres', { serverUrl: 'http://localhost:4000' });

      expect(mockPost).toHaveBeenCalledWith('/mcp/servers/postgres/connect', {});
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Enabling MCP server: postgres'))).toBe(true);
      expect(calls.some(c => c.includes('Enabled postgres server'))).toBe(true);
    });

    test('should display success message with tools hint', async () => {
      await mcpEnable('filesystem', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('cortex mcp tools filesystem'))).toBe(true);
    });

    test('should call correct endpoint with server name', async () => {
      await mcpEnable('github', { serverUrl: 'http://localhost:4000' });

      expect(mockPost).toHaveBeenCalledWith('/mcp/servers/github/connect', {});
    });

    test('should handle success response correctly', async () => {
      mockPost.mockResolvedValue({
        success: true,
        message: 'Connection established'
      });

      await mcpEnable('test-server', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Connection established'))).toBe(true);
    });
  });

  describe('Failure cases', () => {
    test('should handle connection failed (response.success = false)', async () => {
      mockPost.mockResolvedValue({ success: false });

      await mcpEnable('postgres', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Enable failed'))).toBe(true);
    });

    test('should not exit on connection failure (success = false)', async () => {
      mockPost.mockResolvedValue({ success: false });

      await mcpEnable('postgres', { serverUrl: 'http://localhost:4000' });

      expect(processExitSpy).not.toHaveBeenCalled();
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockPost.mockRejectedValue(new Error('Connection timeout'));

      await expect(
        mcpEnable('postgres', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Connection timeout');
    });

    test('should handle server not found error', async () => {
      mockPost.mockRejectedValue(new Error('Server not found'));

      await expect(
        mcpEnable('unknown', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Server not found');
    });

    test('should handle API error', async () => {
      mockPost.mockRejectedValue(new Error('Internal server error'));

      await expect(
        mcpEnable('postgres', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    test('should handle error with empty message', async () => {
      mockPost.mockRejectedValue(new Error());

      await expect(
        mcpEnable('postgres', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
