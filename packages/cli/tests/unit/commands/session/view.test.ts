/**
 * Unit tests for session/view command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { viewSession } from '../../../../src/commands/session/view.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

vi.mock('../../../../src/client/CortexClient.js', () => ({
  CortexClient: vi.fn()
}));

describe('viewSession command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockSessionData = {
    id: 'session-123',
    metadata: {
      startTime: '2025-01-14T20:00:00.000Z'
    },
    messageCount: 5,
    fileSize: 2048
  };

  const mockMessagesData = {
    messages: [
      {
        role: 'user',
        content: 'Hello, how are you?'
      },
      {
        role: 'assistant',
        content: 'I am doing well, thank you!'
      },
      {
        role: 'system',
        content: 'System message here'
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Please use this tool' },
          { type: 'tool_use', name: 'search_web', input: {} }
        ]
      },
      {
        role: 'assistant',
        content: [
          { type: 'tool_result', content: 'Tool output here' },
          { type: 'text', text: 'Here are the results' }
        ]
      }
    ]
  };

  beforeEach(() => {
    mockGet = vi.fn()
      .mockResolvedValueOnce(mockSessionData)
      .mockResolvedValueOnce(mockMessagesData);

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
    test('should display session details with formatted output', async () => {
      await viewSession('session-123', { serverUrl: 'http://localhost:4000' });

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(mockGet).toHaveBeenNthCalledWith(1, '/sessions/session-123');
      expect(mockGet).toHaveBeenNthCalledWith(2, '/sessions/session-123/messages');

      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Session: session-123'))).toBe(true);
    });

    test('should display message count and file size', async () => {
      await viewSession('session-123', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Messages: 5'))).toBe(true);
      expect(calls.some(c => c.includes('Size: 2.0 KB'))).toBe(true);
    });

    test('should format created date', async () => {
      await viewSession('session-123', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Created:'))).toBe(true);
    });

    test('should display string content messages', async () => {
      await viewSession('session-123', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Hello, how are you?'))).toBe(true);
      expect(calls.some(c => c.includes('I am doing well, thank you!'))).toBe(true);
    });

    test('should display all message roles', async () => {
      await viewSession('session-123', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('USER:'))).toBe(true);
      expect(calls.some(c => c.includes('ASSISTANT:'))).toBe(true);
      expect(calls.some(c => c.includes('SYSTEM:'))).toBe(true);
    });

    test('should handle array content with text blocks', async () => {
      await viewSession('session-123', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Please use this tool'))).toBe(true);
      expect(calls.some(c => c.includes('Here are the results'))).toBe(true);
    });

    test('should handle array content with tool_use blocks', async () => {
      await viewSession('session-123', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('[Tool: search_web]'))).toBe(true);
    });

    test('should handle array content with tool_result blocks', async () => {
      await viewSession('session-123', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('[Tool Result]'))).toBe(true);
    });

    test('should format bytes in B', async () => {
      mockGet.mockReset()
        .mockResolvedValueOnce({ ...mockSessionData, fileSize: 512 })
        .mockResolvedValueOnce(mockMessagesData);

      await viewSession('session-123', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('512 B'))).toBe(true);
    });

    test('should format bytes in KB', async () => {
      mockGet.mockReset()
        .mockResolvedValueOnce({ ...mockSessionData, fileSize: 2048 })
        .mockResolvedValueOnce(mockMessagesData);

      await viewSession('session-123', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('2.0 KB'))).toBe(true);
    });

    test('should format bytes in MB', async () => {
      mockGet.mockReset()
        .mockResolvedValueOnce({ ...mockSessionData, fileSize: 2097152 })
        .mockResolvedValueOnce(mockMessagesData);

      await viewSession('session-123', { serverUrl: 'http://localhost:4000' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('2.0 MB'))).toBe(true);
    });
  });

  describe('JSON output', () => {
    test('should display JSON output', async () => {
      await viewSession('session-123', { serverUrl: 'http://localhost:4000', json: true });

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.session).toEqual(mockSessionData);
      expect(parsed.messages).toEqual(mockMessagesData.messages);
    });

    test('should not display formatted output in JSON mode', async () => {
      await viewSession('session-123', { serverUrl: 'http://localhost:4000', json: true });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Session:'))).toBe(false);
      expect(calls.some(c => c.includes('Messages:'))).toBe(false);
    });

    test('should still make both API calls in JSON mode', async () => {
      await viewSession('session-123', { serverUrl: 'http://localhost:4000', json: true });

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(mockGet).toHaveBeenNthCalledWith(1, '/sessions/session-123');
      expect(mockGet).toHaveBeenNthCalledWith(2, '/sessions/session-123/messages');
    });
  });

  describe('Error cases', () => {
    test('should handle network error on session fetch', async () => {
      mockGet.mockReset().mockRejectedValue(new Error('Connection timeout'));

      await expect(
        viewSession('session-123', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Connection timeout');
    });

    test('should handle network error on messages fetch', async () => {
      mockGet.mockReset()
        .mockResolvedValueOnce(mockSessionData)
        .mockRejectedValueOnce(new Error('Failed to fetch messages'));

      await expect(
        viewSession('session-123', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Failed to fetch messages');
    });

    test('should handle session not found', async () => {
      mockGet.mockReset().mockRejectedValue(new Error('Session not found'));

      await expect(
        viewSession('unknown', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Session not found');
    });

    test('should handle API error', async () => {
      mockGet.mockReset().mockRejectedValue(new Error('Internal server error'));

      await expect(
        viewSession('session-123', { serverUrl: 'http://localhost:4000' })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
