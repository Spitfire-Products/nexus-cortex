/**
 * Unit tests for session/list command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { listSessions } from '../../../../src/commands/session/list.js';
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

describe('listSessions command', () => {
  let mockInitialize: any;
  let mockListSessions: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockSessionsData = {
    sessions: [
      {
        sessionId: 'session-123-abc-def',
        metadata: {
          startTime: '2025-01-14T10:00:00Z'
        },
        messageCount: 5,
        fileSize: 12500
      },
      {
        sessionId: 'session-456-ghi-jkl',
        metadata: {
          startTime: '2025-01-13T15:00:00Z'
        },
        messageCount: 10,
        fileSize: 2500000
      },
      {
        sessionId: 'session-789-mno-pqr',
        metadata: {
          startTime: '2025-01-12T08:30:00Z'
        },
        messageCount: 3,
        fileSize: 500
      }
    ]
  };

  beforeEach(() => {
    mockInitialize = vi.fn().mockResolvedValue(undefined);
    mockListSessions = vi.fn().mockResolvedValue(mockSessionsData);

    (OrchestratorClient as any).mockImplementation(() => ({
      initialize: mockInitialize,
      listSessions: mockListSessions
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
    test('should list all sessions with formatted output', async () => {
      await listSessions({});

      expect(mockListSessions).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('Sessions') && c.includes('3 total'))).toBe(true);
      expect(calls.some((c: string) => c.includes('session-'))).toBe(true);
      expect(calls.some((c: string) => c.includes('Created:'))).toBe(true);
      expect(calls.some((c: string) => c.includes('Messages:'))).toBe(true);
      expect(calls.some((c: string) => c.includes('Size:'))).toBe(true);
    });

    test('should list sessions with JSON output', async () => {
      await listSessions({ json: true });

      expect(mockListSessions).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledOnce();

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty('sessions');
      expect(parsed.sessions).toHaveLength(3);
      expect(parsed.sessions[0].sessionId).toBe('session-123-abc-def');
    });

    test('should apply limit when specified', async () => {
      await listSessions({ limit: 2 });

      expect(mockListSessions).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('3 total'))).toBe(true);
      expect(calls.some((c: string) => c.includes('and 1 more'))).toBe(true);
    });

    test('should apply limit with JSON output', async () => {
      await listSessions({ limit: 1, json: true });

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.sessions).toHaveLength(1);
      expect(parsed.sessions[0].sessionId).toBe('session-123-abc-def');
    });

    test('should handle empty sessions list', async () => {
      mockListSessions.mockResolvedValue({ sessions: [] });

      await listSessions({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('0 total'))).toBe(true);
      expect(calls.some((c: string) => c.includes('No sessions found'))).toBe(true);
    });

    test('should handle missing sessions property', async () => {
      mockListSessions.mockResolvedValue({});

      await listSessions({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('0 total'))).toBe(true);
      expect(calls.some((c: string) => c.includes('No sessions found'))).toBe(true);
    });

    test('should use custom serverUrl when provided', async () => {
      await listSessions({ serverUrl: 'http://custom:8080' });

      expect(OrchestratorClient).toHaveBeenCalledWith(
        expect.objectContaining({ serverUrl: 'http://custom:8080' })
      );
      expect(mockListSessions).toHaveBeenCalled();
    });

    test('should format bytes correctly', async () => {
      mockListSessions.mockResolvedValue({
        sessions: [
          {
            sessionId: 'session-small',
            metadata: { startTime: '2025-01-14T10:00:00Z' },
            messageCount: 1,
            fileSize: 500
          },
          {
            sessionId: 'session-medium',
            metadata: { startTime: '2025-01-14T10:00:00Z' },
            messageCount: 1,
            fileSize: 5120
          },
          {
            sessionId: 'session-large',
            metadata: { startTime: '2025-01-14T10:00:00Z' },
            messageCount: 1,
            fileSize: 2097152
          }
        ]
      });

      await listSessions({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('500 B'))).toBe(true);
      expect(calls.some((c: string) => c.includes('5.0 KB'))).toBe(true);
      expect(calls.some((c: string) => c.includes('2.0 MB'))).toBe(true);
    });

    test('should display session ID substring (first 8 chars)', async () => {
      await listSessions({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('session-'))).toBe(true);
    });

    test('should format date and time correctly', async () => {
      await listSessions({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('Created:'))).toBe(true);
    });

    test('should not show "more" message when limit equals total', async () => {
      await listSessions({ limit: 3 });

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('and') && c.includes('more'))).toBe(false);
    });

    test('should handle limit of 0 (falsy, shows all)', async () => {
      await listSessions({ limit: 0 });

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('3 total'))).toBe(true);
      expect(calls.some((c: string) => c.includes('and') && c.includes('more'))).toBe(false);
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockListSessions.mockRejectedValue(new Error('Connection refused'));

      await listSessions({});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.anything(),
        'Connection refused'
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle API error', async () => {
      mockListSessions.mockRejectedValue(new Error('Server error'));

      await listSessions({});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.anything(),
        'Server error'
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle error with empty message', async () => {
      mockListSessions.mockRejectedValue(new Error());

      await listSessions({});

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
