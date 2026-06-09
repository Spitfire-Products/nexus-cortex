/**
 * Unit tests for mcp/list command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { listMcpServers } from '../../../../src/commands/mcp/list.js';
import { OrchestratorClient } from '../../../../src/orchestrator/OrchestratorClient.js';

vi.mock('../../../../src/orchestrator/OrchestratorClient.js', () => ({
  OrchestratorClient: vi.fn()
}));

vi.mock('../../../../src/config/ConfigManager.js', () => ({
  ConfigManager: {
    get: vi.fn().mockReturnValue(undefined),
    load: vi.fn().mockResolvedValue({ serverUrl: 'http://localhost:4000' }),
    clearCache: vi.fn()
  }
}));

describe('listMcpServers command', () => {
  let mockInitialize: any;
  let mockListMcpServers: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockServersData = {
    enabled: true,
    servers: [
      {
        name: 'postgres',
        status: 'connected',
        toolCount: 8,
        description: 'PostgreSQL database access'
      },
      {
        name: 'filesystem',
        status: 'disconnected',
        toolCount: 12,
        description: null,
        lastError: 'Connection failed'
      }
    ]
  };

  beforeEach(() => {
    mockInitialize = vi.fn().mockResolvedValue(undefined);
    mockListMcpServers = vi.fn().mockResolvedValue(mockServersData);

    (OrchestratorClient as any).mockImplementation(() => ({
      initialize: mockInitialize,
      listMcpServers: mockListMcpServers
    }));

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
    test('should list MCP servers with formatted output', async () => {
      await listMcpServers({ serverUrl: 'http://localhost:4000' });

      expect(mockListMcpServers).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('MCP Servers') && c.includes('2 total'))).toBe(true);
      expect(calls.some((c: string) => c.includes('postgres'))).toBe(true);
      expect(calls.some((c: string) => c.includes('filesystem'))).toBe(true);
      expect(calls.some((c: string) => c.includes('PostgreSQL database access'))).toBe(true);
    });

    test('should display JSON output', async () => {
      await listMcpServers({ serverUrl: 'http://localhost:4000', json: true });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toEqual(mockServersData);
    });

    test('should show MCP not enabled warning', async () => {
      mockListMcpServers.mockResolvedValue({ enabled: false });

      await listMcpServers({ serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));
      expect(calls.some((c: string) => c.includes('MCP is not enabled'))).toBe(true);
    });

    test('should handle empty servers list', async () => {
      mockListMcpServers.mockResolvedValue({ enabled: true, servers: [] });

      await listMcpServers({ serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));
      expect(calls.some((c: string) => c.includes('No MCP servers configured'))).toBe(true);
    });

    test('should handle missing servers property', async () => {
      mockListMcpServers.mockResolvedValue({ enabled: true });

      await listMcpServers({ serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));
      expect(calls.some((c: string) => c.includes('No MCP servers configured'))).toBe(true);
    });

    test('should display server status correctly', async () => {
      await listMcpServers({ serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('Connected'))).toBe(true);
      expect(calls.some((c: string) => c.includes('Disconnected'))).toBe(true);
    });

    test('should display tool counts', async () => {
      await listMcpServers({ serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('Tools: 8'))).toBe(true);
      expect(calls.some((c: string) => c.includes('Tools: 12'))).toBe(true);
    });

    test('should display last error when present', async () => {
      await listMcpServers({ serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));
      expect(calls.some((c: string) => c.includes('Last Error: Connection failed'))).toBe(true);
    });

    test('should display description when present', async () => {
      await listMcpServers({ serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('PostgreSQL database access'))).toBe(true);
    });

    test('should handle server with no toolCount', async () => {
      mockListMcpServers.mockResolvedValue({
        enabled: true,
        servers: [{ name: 'test', status: 'connected' }]
      });

      await listMcpServers({ serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));
      expect(calls.some((c: string) => c.includes('Tools: 0'))).toBe(true);
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockListMcpServers.mockRejectedValue(new Error('Connection refused'));

      await expect(
        listMcpServers({ serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Connection refused');
    });

    test('should handle API error', async () => {
      mockListMcpServers.mockRejectedValue(new Error('Server error'));

      await expect(
        listMcpServers({ serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    test('should handle error with empty message', async () => {
      mockListMcpServers.mockRejectedValue(new Error());

      await expect(
        listMcpServers({ serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
