/**
 * Unit tests for mcp/server command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mcpServer } from '../../../../src/commands/mcp/server.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

vi.mock('../../../../src/client/CortexClient.js', () => ({
  CortexClient: vi.fn()
}));

describe('mcpServer command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockServerData = {
    name: 'postgres',
    status: 'connected',
    toolCount: 8,
    description: 'PostgreSQL database access',
    config: {
      host: 'localhost',
      port: 5432
    },
    capabilities: {
      supportsTransactions: true,
      maxConnections: 100
    }
  };

  beforeEach(() => {
    mockGet = vi.fn().mockResolvedValue(mockServerData);
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

  describe('Success cases - formatted output', () => {
    test('should display server details with formatted output', async () => {
      await mcpServer('postgres', { serverUrl: 'http://localhost:4000' });

      expect(mockGet).toHaveBeenCalledWith('/mcp/servers/postgres');
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('MCP Server: postgres'))).toBe(true);
    });

    test('should show connected status', async () => {
      await mcpServer('postgres', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Connected'))).toBe(true);
    });

    test('should show disconnected status', async () => {
      mockGet.mockResolvedValue({
        ...mockServerData,
        status: 'disconnected'
      });

      await mcpServer('postgres', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Disconnected'))).toBe(true);
    });

    test('should display tool count', async () => {
      await mcpServer('postgres', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Tools: 8'))).toBe(true);
    });

    test('should handle missing tool count (default to 0)', async () => {
      mockGet.mockResolvedValue({
        name: 'test-server',
        status: 'connected'
      });

      await mcpServer('test-server', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Tools: 0'))).toBe(true);
    });

    test('should display description when present', async () => {
      await mcpServer('postgres', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('PostgreSQL database access'))).toBe(true);
    });

    test('should not display description when missing', async () => {
      mockGet.mockResolvedValue({
        name: 'test-server',
        status: 'connected',
        toolCount: 5
      });

      await mcpServer('test-server', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Description:'))).toBe(false);
    });

    test('should display config when present', async () => {
      await mcpServer('postgres', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Configuration:'))).toBe(true);
      expect(calls.some(c => c.includes('localhost'))).toBe(true);
      expect(calls.some(c => c.includes('5432'))).toBe(true);
    });

    test('should not display config when missing', async () => {
      mockGet.mockResolvedValue({
        name: 'test-server',
        status: 'connected',
        toolCount: 5
      });

      await mcpServer('test-server', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Configuration:'))).toBe(false);
    });

    test('should display last error when present', async () => {
      mockGet.mockResolvedValue({
        ...mockServerData,
        lastError: 'Connection timeout'
      });

      await mcpServer('postgres', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Last Error: Connection timeout'))).toBe(true);
    });

    test('should not display last error when missing', async () => {
      await mcpServer('postgres', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Last Error:'))).toBe(false);
    });

    test('should display capabilities when present', async () => {
      await mcpServer('postgres', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Capabilities:'))).toBe(true);
      expect(calls.some(c => c.includes('supportsTransactions'))).toBe(true);
      expect(calls.some(c => c.includes('maxConnections'))).toBe(true);
    });

    test('should not display capabilities when missing', async () => {
      mockGet.mockResolvedValue({
        name: 'test-server',
        status: 'connected',
        toolCount: 5
      });

      await mcpServer('test-server', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Capabilities:'))).toBe(false);
    });
  });

  describe('JSON output', () => {
    test('should display JSON output', async () => {
      await mcpServer('postgres', { serverUrl: 'http://localhost:4000', json: true });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toEqual(mockServerData);
    });

    test('should not display formatted output in JSON mode', async () => {
      await mcpServer('postgres', { serverUrl: 'http://localhost:4000', json: true });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('MCP Server:'))).toBe(false);
      expect(calls.some(c => c.includes('Status:'))).toBe(false);
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockGet.mockRejectedValue(new Error('Connection timeout'));

      await expect(
        mcpServer('postgres', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Connection timeout');
    });

    test('should handle server not found error', async () => {
      mockGet.mockRejectedValue(new Error('Server not found'));

      await expect(
        mcpServer('unknown', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Server not found');
    });

    test('should handle API error', async () => {
      mockGet.mockRejectedValue(new Error('Internal server error'));

      await expect(
        mcpServer('postgres', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
