/**
 * Unit tests for session/resume command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { resumeSession } from '../../../../src/commands/session/resume.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

// Mock the CortexClient
vi.mock('../../../../src/client/CortexClient.js', () => {
  return {
    CortexClient: vi.fn()
  };
});

describe('resumeSession command', () => {
  let mockPost: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockResumeData = {
    checkpoint: {
      id: 'checkpoint-123',
      description: 'Test checkpoint'
    },
    messageCount: 5
  };

  beforeEach(() => {
    mockPost = vi.fn().mockResolvedValue(mockResumeData);

    (CortexClient as any).mockImplementation(() => ({
      post: mockPost
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
    test('should resume session with checkpoint', async () => {
      await resumeSession('session-123', { checkpointId: 'checkpoint-123' });

      expect(mockPost).toHaveBeenCalledWith('/sessions/session-123/resume', {
        checkpointId: 'checkpoint-123'
      });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('Session resumed from checkpoint'))).toBe(true);
      expect(calls.some(c => c.includes('checkpoint-123'))).toBe(true);
      expect(calls.some(c => c.includes('Messages loaded: 5'))).toBe(true);
    });

    test('should show usage instructions after resume', async () => {
      await resumeSession('session-456', { checkpointId: 'checkpoint-abc' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('Start interactive chat'))).toBe(true);
      expect(calls.some(c => c.includes('cortex chat --session session-456'))).toBe(true);
    });

    test('should use custom serverUrl when provided', async () => {
      await resumeSession('session-789', {
        serverUrl: 'http://custom:8080',
        checkpointId: 'checkpoint-xyz'
      });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
      expect(mockPost).toHaveBeenCalled();
    });

    test('should display checkpoint information', async () => {
      const customData = {
        checkpoint: {
          id: 'checkpoint-custom',
          description: 'Custom checkpoint'
        },
        messageCount: 10
      };

      mockPost.mockResolvedValue(customData);

      await resumeSession('session-test', { checkpointId: 'checkpoint-custom' });

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));

      expect(calls.some(c => c.includes('checkpoint-custom'))).toBe(true);
      expect(calls.some(c => c.includes('Messages loaded: 10'))).toBe(true);
    });
  });

  describe('Validation cases', () => {
    test('should require checkpointId parameter', async () => {
      await expect(resumeSession('session-123', {})).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0][0];
      expect(errorCall).toContain('--checkpoint-id is required');
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(mockPost).not.toHaveBeenCalled();
    });

    test('should not call API when checkpointId is missing', async () => {
      await expect(resumeSession('session-123', { serverUrl: 'http://test:4000' })).rejects.toThrow('process.exit(1)');

      expect(mockPost).not.toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockPost.mockRejectedValue(new Error('Connection timeout'));

      await expect(resumeSession('session-123', { checkpointId: 'checkpoint-123' })).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Connection timeout');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle checkpoint not found error', async () => {
      mockPost.mockRejectedValue(new Error('Checkpoint not found'));

      await expect(resumeSession('session-123', { checkpointId: 'invalid' })).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Checkpoint not found');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle session not found error', async () => {
      mockPost.mockRejectedValue(new Error('Session not found'));

      await expect(resumeSession('nonexistent', { checkpointId: 'checkpoint-123' })).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0].join(' ');
      expect(errorCall).toContain('Session not found');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should handle error with empty message', async () => {
      mockPost.mockRejectedValue(new Error());

      await expect(resumeSession('session-123', { checkpointId: 'checkpoint-123' })).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
