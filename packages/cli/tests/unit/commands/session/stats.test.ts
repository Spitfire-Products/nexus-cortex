/**
 * Unit tests for session/stats command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { sessionStats } from '../../../../src/commands/session/stats.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

vi.mock('../../../../src/client/CortexClient.js', () => ({
  CortexClient: vi.fn()
}));

describe('sessionStats command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockStatsData = {
    created: '2025-01-14T10:00:00Z',
    lastModified: '2025-01-14T12:00:00Z',
    fileSize: 125000,
    messageCount: 10,
    userMessages: 5,
    assistantMessages: 5,
    turnCount: 5,
    toolUses: 3,
    tokens: {
      input: 5000,
      output: 3000,
      cacheRead: 2000,
      cacheWrite: 1000,
      total: 11000
    }
  };

  beforeEach(() => {
    mockGet = vi.fn().mockResolvedValue(mockStatsData);
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
    test('should display stats with formatted output', async () => {
      await sessionStats('session-123', {});

      expect(mockGet).toHaveBeenCalledWith('/sessions/session-123/stats');
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('Session Statistics: session-123'))).toBe(true);
      expect(calls.some(c => c.includes('Session Info:'))).toBe(true);
      expect(calls.some(c => c.includes('Messages:'))).toBe(true);
      expect(calls.some(c => c.includes('Tokens:'))).toBe(true);
    });

    test('should display JSON output', async () => {
      await sessionStats('session-456', { json: true });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toEqual(mockStatsData);
    });

    test('should format file size correctly', async () => {
      await sessionStats('session-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('122.1 KB'))).toBe(true);
    });

    test('should format token numbers with localization', async () => {
      await sessionStats('session-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      // toLocaleString() formats numbers with commas
      expect(calls.some(c => c.includes('5,000') || c.includes('5000'))).toBe(true);
    });

    test('should show cache efficiency when cache is used', async () => {
      await sessionStats('session-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      // cacheRead: 2000, total: 11000 = 18% efficiency
      expect(calls.some(c => c.includes('Cache Efficiency: 18%'))).toBe(true);
    });

    test('should not show cache efficiency when no cache read', async () => {
      mockGet.mockResolvedValue({
        ...mockStatsData,
        tokens: { ...mockStatsData.tokens, cacheRead: 0 }
      });

      await sessionStats('session-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Cache Efficiency'))).toBe(false);
    });

    test('should use custom serverUrl', async () => {
      await sessionStats('session-789', { serverUrl: 'http://custom:8080' });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
    });

    test('should display all message counts', async () => {
      await sessionStats('session-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('Total: 10'))).toBe(true);
      expect(calls.some(c => c.includes('User: 5'))).toBe(true);
      expect(calls.some(c => c.includes('Assistant: 5'))).toBe(true);
      expect(calls.some(c => c.includes('Turns: 5'))).toBe(true);
      expect(calls.some(c => c.includes('Tool Uses: 3'))).toBe(true);
    });

    test('should display all token counts', async () => {
      await sessionStats('session-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('Input:'))).toBe(true);
      expect(calls.some(c => c.includes('Output:'))).toBe(true);
      expect(calls.some(c => c.includes('Cache Read:'))).toBe(true);
      expect(calls.some(c => c.includes('Cache Write:'))).toBe(true);
      expect(calls.some(c => c.includes('Total:') && c.includes('11,'))).toBe(true);
    });

    test('should format bytes for different sizes', async () => {
      // Test KB size
      mockGet.mockResolvedValue({ ...mockStatsData, fileSize: 5120 });
      await sessionStats('session-123', {});
      let calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('5.0 KB'))).toBe(true);

      vi.clearAllMocks();

      // Test MB size
      mockGet.mockResolvedValue({ ...mockStatsData, fileSize: 2097152 });
      await sessionStats('session-123', {});
      calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('2.0 MB'))).toBe(true);

      vi.clearAllMocks();

      // Test bytes
      mockGet.mockResolvedValue({ ...mockStatsData, fileSize: 500 });
      await sessionStats('session-123', {});
      calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('500 B'))).toBe(true);
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockGet.mockRejectedValue(new Error('Connection timeout'));

      await expect(sessionStats('session-123', {})).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Connection timeout');
    });

    test('should handle session not found', async () => {
      mockGet.mockRejectedValue(new Error('Session not found'));

      await expect(sessionStats('nonexistent', {})).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Session not found');
    });

    test('should handle error with empty message', async () => {
      mockGet.mockRejectedValue(new Error());

      await expect(sessionStats('session-123', {})).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
