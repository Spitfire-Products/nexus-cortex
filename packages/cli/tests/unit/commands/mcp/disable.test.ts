/**
 * Unit tests for mcp/disable command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mcpDisable } from '../../../../src/commands/mcp/disable.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

vi.mock('../../../../src/client/CortexClient.js', () => ({
  CortexClient: vi.fn()
}));

describe('mcpDisable command', () => {
  let mockPost: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockSuccessResponse = {
    success: true,
    message: 'Disabled postgres server'
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
    test('should disconnect from MCP server successfully', async () => {
      await mcpDisable('postgres', { serverUrl: 'http://localhost:4000' });

      expect(mockPost).toHaveBeenCalledWith('/mcp/servers/postgres/disconnect', {});
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Disabling MCP server: postgres'))).toBe(true);
      expect(calls.some(c => c.includes('Disabled postgres server'))).toBe(true);
    });

    test('should display success message', async () => {
      mockPost.mockResolvedValue({
        success: true,
        message: 'Server disconnected successfully'
      });

      await mcpDisable('filesystem', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Server disconnected successfully'))).toBe(true);
    });

    test('should call correct endpoint with server name', async () => {
      await mcpDisable('github', { serverUrl: 'http://localhost:4000' });

      expect(mockPost).toHaveBeenCalledWith('/mcp/servers/github/disconnect', {});
    });

    test('should handle success response correctly', async () => {
      mockPost.mockResolvedValue({
        success: true,
        message: 'Disconnection complete'
      });

      await mcpDisable('test-server', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Disconnection complete'))).toBe(true);
    });
  });

  describe('Failure cases', () => {
    test('should handle disconnect failed (response.success = false)', async () => {
      mockPost.mockResolvedValue({ success: false });

      await mcpDisable('postgres', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Disable failed'))).toBe(true);
    });

    test('should not exit on disconnect failure (success = false)', async () => {
      mockPost.mockResolvedValue({ success: false });

      await mcpDisable('postgres', { serverUrl: 'http://localhost:4000' });

      expect(processExitSpy).not.toHaveBeenCalled();
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockPost.mockRejectedValue(new Error('Connection timeout'));

      await expect(
        mcpDisable('postgres', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Connection timeout');
    });

    test('should handle server not found error', async () => {
      mockPost.mockRejectedValue(new Error('Server not found'));

      await expect(
        mcpDisable('unknown', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Server not found');
    });

    test('should handle API error', async () => {
      mockPost.mockRejectedValue(new Error('Internal server error'));

      await expect(
        mcpDisable('postgres', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    test('should handle error with empty message', async () => {
      mockPost.mockRejectedValue(new Error());

      await expect(
        mcpDisable('postgres', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
