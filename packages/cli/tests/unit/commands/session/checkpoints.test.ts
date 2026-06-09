/**
 * Unit tests for session/checkpoints command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { listCheckpoints } from '../../../../src/commands/session/checkpoints.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

// Mock the CortexClient
vi.mock('../../../../src/client/CortexClient.js', () => {
  return {
    CortexClient: vi.fn()
  };
});

describe('listCheckpoints command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockCheckpointsData = {
    checkpoints: [
      {
        id: 'checkpoint-123',
        description: 'First checkpoint',
        timestamp: '2025-01-14T10:00:00Z',
        messageIds: ['msg-1', 'msg-2', 'msg-3']
      },
      {
        id: 'checkpoint-456',
        description: null,
        timestamp: '2025-01-14T11:00:00Z',
        messageIds: ['msg-1', 'msg-2']
      }
    ]
  };

  beforeEach(() => {
    mockGet = vi.fn().mockResolvedValue(mockCheckpointsData);

    (CortexClient as any).mockImplementation(() => ({
      get: mockGet
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
    test('should list checkpoints with formatted output', async () => {
      await listCheckpoints('session-123', {});

      expect(mockGet).toHaveBeenCalledWith('/sessions/session-123/checkpoints');
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      // Check for header
      expect(calls.some(c => c.includes('Checkpoints for session session-123'))).toBe(true);

      // Check checkpoint IDs are displayed
      expect(calls.some(c => c.includes('checkpoint-123'))).toBe(true);
      expect(calls.some(c => c.includes('checkpoint-456'))).toBe(true);

      // Check description
      expect(calls.some(c => c.includes('First checkpoint'))).toBe(true);
      expect(calls.some(c => c.includes('(no description)'))).toBe(true);

      // Check message count
      expect(calls.some(c => c.includes('Messages: 3'))).toBe(true);
      expect(calls.some(c => c.includes('Messages: 2'))).toBe(true);
    });

    test('should list checkpoints with JSON output', async () => {
      await listCheckpoints('session-456', { json: true });

      expect(mockGet).toHaveBeenCalledWith('/sessions/session-456/checkpoints');
      expect(consoleLogSpy).toHaveBeenCalledOnce();

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty('checkpoints');
      expect(parsed.checkpoints).toHaveLength(2);
      expect(parsed.checkpoints[0].id).toBe('checkpoint-123');
    });

    test('should handle empty checkpoints list', async () => {
      mockGet.mockResolvedValue({ checkpoints: [] });

      await listCheckpoints('session-789', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('No checkpoints found'))).toBe(true);
    });

    test('should handle missing checkpoints property', async () => {
      mockGet.mockResolvedValue({});

      await listCheckpoints('session-789', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('No checkpoints found'))).toBe(true);
    });

    test('should use custom serverUrl when provided', async () => {
      await listCheckpoints('session-abc', { serverUrl: 'http://custom:8080' });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
      expect(mockGet).toHaveBeenCalledWith('/sessions/session-abc/checkpoints');
    });

    test('should format timestamps correctly', async () => {
      await listCheckpoints('session-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      // Should have formatted date/time strings
      expect(calls.some(c => c.includes('Created:'))).toBe(true);
    });

    test('should show usage instructions', async () => {
      await listCheckpoints('session-test', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('Resume from a checkpoint'))).toBe(true);
      expect(calls.some(c => c.includes('cortex sessions resume session-test'))).toBe(true);
    });

    test('should handle checkpoint without description', async () => {
      mockGet.mockResolvedValue({
        checkpoints: [
          {
            id: 'checkpoint-no-desc',
            description: '',
            timestamp: '2025-01-14T10:00:00Z',
            messageIds: ['msg-1']
          }
        ]
      });

      await listCheckpoints('session-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('(no description)'))).toBe(true);
    });

    test('should display multiple checkpoints', async () => {
      const manyCheckpoints = {
        checkpoints: Array.from({ length: 5 }, (_, i) => ({
          id: `checkpoint-${i}`,
          description: `Checkpoint ${i}`,
          timestamp: '2025-01-14T10:00:00Z',
          messageIds: ['msg-1']
        }))
      };

      mockGet.mockResolvedValue(manyCheckpoints);

      await listCheckpoints('session-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('checkpoint-0'))).toBe(true);
      expect(calls.some(c => c.includes('checkpoint-4'))).toBe(true);
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockGet.mockRejectedValue(new Error('Connection timeout'));

      await expect(listCheckpoints('session-123', {})).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Connection timeout');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle session not found error', async () => {
      mockGet.mockRejectedValue(new Error('Session not found'));

      await expect(listCheckpoints('nonexistent', {})).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Session not found');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle API error', async () => {
      mockGet.mockRejectedValue(new Error('Server error'));

      await expect(listCheckpoints('session-123', {})).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle error with empty message', async () => {
      mockGet.mockRejectedValue(new Error());

      await expect(listCheckpoints('session-123', {})).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
