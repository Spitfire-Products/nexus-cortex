/**
 * Unit tests for mcp/tools command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mcpTools } from '../../../../src/commands/mcp/tools.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

vi.mock('../../../../src/client/CortexClient.js', () => ({
  CortexClient: vi.fn()
}));

describe('mcpTools command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockAllToolsData = {
    enabled: true,
    tools: [
      {
        name: 'query_db',
        serverName: 'postgres',
        description: 'Execute SQL query'
      },
      {
        name: 'create_table',
        serverName: 'postgres',
        description: 'Create new table'
      },
      {
        name: 'read_file',
        serverName: 'filesystem',
        description: 'Read file contents'
      },
      {
        name: 'write_file',
        serverName: 'filesystem'
      }
    ]
  };

  const mockServerToolsData = {
    tools: [
      {
        name: 'query_db',
        description: 'Execute SQL query',
        inputSchema: {
          properties: {
            query: {},
            database: {}
          }
        }
      },
      {
        name: 'create_table',
        description: 'Create new table',
        inputSchema: {
          properties: {
            tableName: {},
            columns: {}
          }
        }
      }
    ]
  };

  beforeEach(() => {
    mockGet = vi.fn().mockResolvedValue(mockAllToolsData);
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

  describe('All tools mode', () => {
    test('should list all MCP tools when no server name provided', async () => {
      await mcpTools(undefined, { serverUrl: 'http://localhost:4000' });

      expect(mockGet).toHaveBeenCalledWith('/mcp/tools');
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('MCP Tools') && c.includes('4 total'))).toBe(true);
    });

    test('should list all MCP tools when --all flag provided', async () => {
      await mcpTools('postgres', { serverUrl: 'http://localhost:4000', all: true });

      expect(mockGet).toHaveBeenCalledWith('/mcp/tools');
    });

    test('should group tools by server correctly', async () => {
      await mcpTools(undefined, { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      // Should show postgres server with 2 tools
      expect(calls.some(c => c.includes('postgres') && c.includes('2 tools'))).toBe(true);

      // Should show filesystem server with 2 tools
      expect(calls.some(c => c.includes('filesystem') && c.includes('2 tools'))).toBe(true);
    });

    test('should display tool names and descriptions in all mode', async () => {
      await mcpTools(undefined, { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('query_db'))).toBe(true);
      expect(calls.some(c => c.includes('Execute SQL query'))).toBe(true);
      expect(calls.some(c => c.includes('read_file'))).toBe(true);
      expect(calls.some(c => c.includes('Read file contents'))).toBe(true);
    });

    test('should handle MCP not enabled', async () => {
      mockGet.mockResolvedValue({ enabled: false });

      await mcpTools(undefined, { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('MCP is not enabled'))).toBe(true);
    });

    test('should handle no tools available (all mode)', async () => {
      mockGet.mockResolvedValue({ enabled: true, tools: [] });

      await mcpTools(undefined, { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('No MCP tools available'))).toBe(true);
    });

    test('should handle missing tools array (all mode)', async () => {
      mockGet.mockResolvedValue({ enabled: true });

      await mcpTools(undefined, { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('No MCP tools available'))).toBe(true);
    });

    test('should display JSON output (all mode)', async () => {
      await mcpTools(undefined, { serverUrl: 'http://localhost:4000', json: true });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toEqual(mockAllToolsData);
    });

    test('should handle tool without serverName (default to unknown)', async () => {
      mockGet.mockResolvedValue({
        enabled: true,
        tools: [{ name: 'test_tool' }]
      });

      await mcpTools(undefined, { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('unknown'))).toBe(true);
    });
  });

  describe('Specific server mode', () => {
    beforeEach(() => {
      mockGet.mockResolvedValue(mockServerToolsData);
    });

    test('should list tools from specific server', async () => {
      await mcpTools('postgres', { serverUrl: 'http://localhost:4000' });

      expect(mockGet).toHaveBeenCalledWith('/mcp/servers/postgres/tools');
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Tools from postgres'))).toBe(true);
      expect(calls.some(c => c.includes('2 total'))).toBe(true);
    });

    test('should display tool parameters from inputSchema', async () => {
      await mcpTools('postgres', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('Parameters: query, database'))).toBe(true);
      expect(calls.some(c => c.includes('Parameters: tableName, columns'))).toBe(true);
    });

    test('should display tool descriptions in specific mode', async () => {
      await mcpTools('postgres', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('Execute SQL query'))).toBe(true);
      expect(calls.some(c => c.includes('Create new table'))).toBe(true);
    });

    test('should handle tool without description (specific mode)', async () => {
      mockGet.mockResolvedValue({
        tools: [{ name: 'test_tool' }]
      });

      await mcpTools('test-server', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('test_tool'))).toBe(true);
    });

    test('should handle tool without inputSchema', async () => {
      mockGet.mockResolvedValue({
        tools: [{ name: 'simple_tool', description: 'A simple tool' }]
      });

      await mcpTools('test-server', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('simple_tool'))).toBe(true);
      expect(calls.some(c => c.includes('A simple tool'))).toBe(true);
    });

    test('should handle inputSchema without properties', async () => {
      mockGet.mockResolvedValue({
        tools: [{
          name: 'no_params_tool',
          inputSchema: {}
        }]
      });

      await mcpTools('test-server', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Parameters:'))).toBe(true);
    });

    test('should handle no tools for specific server', async () => {
      mockGet.mockResolvedValue({ tools: [] });

      await mcpTools('empty-server', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Tools from empty-server'))).toBe(true);
      expect(calls.some(c => c.includes('No tools available'))).toBe(true);
    });

    test('should display JSON output (specific mode)', async () => {
      await mcpTools('postgres', { serverUrl: 'http://localhost:4000', json: true });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toEqual(mockServerToolsData);
    });
  });

  describe('Error cases', () => {
    test('should handle network error (all mode)', async () => {
      mockGet.mockRejectedValue(new Error('Connection timeout'));

      await expect(
        mcpTools(undefined, { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Connection timeout');
    });

    test('should handle network error (specific mode)', async () => {
      mockGet.mockRejectedValue(new Error('Connection refused'));

      await expect(
        mcpTools('postgres', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    test('should handle server not found', async () => {
      mockGet.mockRejectedValue(new Error('Server not found'));

      await expect(
        mcpTools('unknown', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Server not found');
    });

    test('should handle API error', async () => {
      mockGet.mockRejectedValue(new Error('Internal server error'));

      await expect(
        mcpTools('postgres', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
