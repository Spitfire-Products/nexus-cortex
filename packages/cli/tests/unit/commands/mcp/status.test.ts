/**
 * Unit tests for mcp/status command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mcpStatus } from '../../../../src/commands/mcp/status.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

vi.mock('../../../../src/client/CortexClient.js', () => ({
  CortexClient: vi.fn()
}));

describe('mcpStatus command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockStatusData = {
    enabled: true,
    serverCount: 3,
    connectedCount: 2,
    toolCount: 25,
    servers: [
      {
        name: 'postgres',
        status: 'connected',
        toolCount: 8
      },
      {
        name: 'filesystem',
        status: 'connected',
        toolCount: 12
      },
      {
        name: 'github',
        status: 'disconnected',
        toolCount: 5,
        lastError: 'Authentication failed'
      }
    ]
  };

  beforeEach(() => {
    mockGet = vi.fn().mockResolvedValue(mockStatusData);
    (CortexClient as any).mockImplementation(() => ({ get: mockGet }));

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
    test('should display MCP status with formatted output', async () => {
      await mcpStatus({ serverUrl: 'http://localhost:4000' });

      expect(mockGet).toHaveBeenCalledWith('/mcp/status');
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('MCP Status'))).toBe(true);
      expect(calls.some(c => c.includes('Status: Enabled'))).toBe(true);
      expect(calls.some(c => c.includes('Servers: 3'))).toBe(true);
      expect(calls.some(c => c.includes('Connected: 2'))).toBe(true);
      expect(calls.some(c => c.includes('Total Tools: 25'))).toBe(true);
    });

    test('should display JSON output', async () => {
      await mcpStatus({ serverUrl: 'http://localhost:4000', json: true });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toEqual(mockStatusData);
    });

    test('should show disabled status', async () => {
      mockGet.mockResolvedValue({ enabled: false });

      await mcpStatus({ serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Status: Disabled'))).toBe(true);
    });

    test('should list all servers with status', async () => {
      await mcpStatus({ serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('Servers:'))).toBe(true);
      expect(calls.some(c => c.includes('postgres'))).toBe(true);
      expect(calls.some(c => c.includes('filesystem'))).toBe(true);
      expect(calls.some(c => c.includes('github'))).toBe(true);
    });

    test('should display tool counts per server', async () => {
      await mcpStatus({ serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('8 tools'))).toBe(true);
      expect(calls.some(c => c.includes('12 tools'))).toBe(true);
      expect(calls.some(c => c.includes('5 tools'))).toBe(true);
    });

    test('should show errors for servers with lastError', async () => {
      await mcpStatus({ serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Error: Authentication failed'))).toBe(true);
    });

    test('should handle missing server counts', async () => {
      mockGet.mockResolvedValue({ enabled: true });

      await mcpStatus({ serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('Servers: 0'))).toBe(true);
      expect(calls.some(c => c.includes('Connected: 0'))).toBe(true);
      expect(calls.some(c => c.includes('Total Tools: 0'))).toBe(true);
    });

    test('should handle empty servers array', async () => {
      mockGet.mockResolvedValue({
        enabled: true,
        serverCount: 0,
        connectedCount: 0,
        toolCount: 0,
        servers: []
      });

      await mcpStatus({ serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      // Should show status but no server list
      expect(calls.some(c => c.includes('Status: Enabled'))).toBe(true);
    });

    test('should handle server without toolCount', async () => {
      mockGet.mockResolvedValue({
        enabled: true,
        servers: [{ name: 'test', status: 'connected' }]
      });

      await mcpStatus({ serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('0 tools'))).toBe(true);
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockGet.mockRejectedValue(new Error('Connection timeout'));

      await expect(
        mcpStatus({ serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Connection timeout');
    });

    test('should handle API error', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      await expect(
        mcpStatus({ serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    test('should handle error with empty message', async () => {
      mockGet.mockRejectedValue(new Error());

      await expect(
        mcpStatus({ serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
