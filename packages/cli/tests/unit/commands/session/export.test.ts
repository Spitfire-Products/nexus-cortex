/**
 * Unit tests for session/export command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { exportSession } from '../../../../src/commands/session/export.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';
import { writeFile } from 'fs/promises';

// Mock ConfigManager
vi.mock('../../../../src/config/ConfigManager.js', () => ({
  ConfigManager: {
    get: vi.fn(() => 'http://localhost:4000')
  }
}));

// Mock the CortexClient
vi.mock('../../../../src/client/CortexClient.js', () => {
  return {
    CortexClient: vi.fn()
  };
});

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn()
  },
  writeFile: vi.fn()
}));

describe('exportSession command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockSessionData = {
    sessionId: 'session-123',
    metadata: {
      startTime: '2025-01-14T10:00:00Z',
      model: 'claude-sonnet-4-5'
    },
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' }
    ]
  };

  beforeEach(() => {
    mockGet = vi.fn().mockResolvedValue(mockSessionData);
    (writeFile as any).mockResolvedValue(undefined);

    (CortexClient as any).mockImplementation(() => ({
      get: mockGet
    }));

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Success cases', () => {
    test('should export session to stdout', async () => {
      await exportSession('session-123', {});

      expect(mockGet).toHaveBeenCalledWith('/sessions/session-123/export');
      expect(consoleLogSpy).toHaveBeenCalledOnce();

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toMatchObject({
        sessionId: 'session-123',
        metadata: {
          model: 'claude-sonnet-4-5'
        }
      });
      expect(writeFile).not.toHaveBeenCalled();
    });

    test('should export session to file', async () => {
      await exportSession('session-123', { output: 'export.json' });

      expect(mockGet).toHaveBeenCalledWith('/sessions/session-123/export');
      expect(writeFile).toHaveBeenCalledWith(
        'export.json',
        expect.stringContaining('"sessionId": "session-123"'),
        'utf-8'
      );

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Session exported to export.json'))).toBe(true);
    });

    test('should format JSON with 2 space indentation', async () => {
      await exportSession('session-123', {});

      const output = consoleLogSpy.mock.calls[0][0];

      // Check that it's formatted (has newlines and indentation)
      expect(output).toContain('\n');
      expect(output).toContain('  '); // 2 space indent
    });

    test('should use custom serverUrl when provided', async () => {
      await exportSession('session-456', { serverUrl: 'http://custom:8080' });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
      expect(mockGet).toHaveBeenCalledWith('/sessions/session-456/export');
    });

    test('should export to file with custom path', async () => {
      await exportSession('session-789', { output: '/tmp/custom/export.json' });

      expect(writeFile).toHaveBeenCalledWith(
        '/tmp/custom/export.json',
        expect.any(String),
        'utf-8'
      );

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('/tmp/custom/export.json'))).toBe(true);
    });

    test('should handle session IDs with special characters', async () => {
      await exportSession('session-abc-123-def', {});

      expect(mockGet).toHaveBeenCalledWith('/sessions/session-abc-123-def/export');
    });

    test('should preserve all session data in export', async () => {
      const complexData = {
        sessionId: 'session-complex',
        metadata: {
          startTime: '2025-01-14T10:00:00Z',
          model: 'claude-sonnet-4-5',
          customField: 'value'
        },
        messages: [
          { role: 'user', content: 'Test', metadata: { timestamp: 123 } }
        ],
        stats: {
          totalTokens: 1000
        }
      };

      mockGet.mockResolvedValue(complexData);

      await exportSession('session-complex', {});

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toEqual(complexData);
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockGet.mockRejectedValue(new Error('Connection timeout'));

      await exportSession('session-123', {});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.anything(),
        'Connection timeout'
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle session not found', async () => {
      mockGet.mockRejectedValue(new Error('Session not found'));

      await exportSession('nonexistent', {});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.anything(),
        'Session not found'
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle file write error', async () => {
      (writeFile as any).mockRejectedValue(new Error('Permission denied'));

      await exportSession('session-123', { output: '/readonly/file.json' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.anything(),
        'Permission denied'
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle error with empty message', async () => {
      mockGet.mockRejectedValue(new Error());

      await exportSession('session-123', {});

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle API returning invalid data', async () => {
      mockGet.mockResolvedValue(null);

      await exportSession('session-123', {});

      // Should still output (JSON.stringify handles null)
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });
});
