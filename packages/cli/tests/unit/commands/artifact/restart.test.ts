/**
 * Unit tests for artifact/restart command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { artifactRestart } from '../../../../src/commands/artifact/restart.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

// Mock the CortexClient
vi.mock('../../../../src/client/CortexClient.js', () => {
  return {
    CortexClient: vi.fn()
  };
});

describe('artifactRestart command', () => {
  let mockPost: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockRestartData = {
    url: 'http://localhost:3000',
    port: 3000,
    message: 'Artifact restarted successfully'
  };

  beforeEach(() => {
    mockPost = vi.fn().mockResolvedValue(mockRestartData);

    (CortexClient as any).mockImplementation(() => ({
      post: mockPost
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
    test('should restart artifact', async () => {
      await artifactRestart('artifact-123', {});

      expect(mockPost).toHaveBeenCalledWith('/artifact/restart', { id: 'artifact-123' });
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Artifact restarted successfully'))).toBe(true);
    });

    test('should display URL and port', async () => {
      await artifactRestart('artifact-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('http://localhost:3000'))).toBe(true);
      expect(calls.some(c => c.includes('3000'))).toBe(true);
    });

    test('should display view instructions', async () => {
      await artifactRestart('artifact-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('View artifact with'))).toBe(true);
      expect(calls.some(c => c.includes('cortex artifact view'))).toBe(true);
    });

    test('should output JSON format when requested', async () => {
      await artifactRestart('artifact-123', { json: true });

      expect(consoleLogSpy).toHaveBeenCalledOnce();

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.url).toBe('http://localhost:3000');
      expect(parsed.port).toBe(3000);
    });

    test('should use custom serverUrl when provided', async () => {
      await artifactRestart('artifact-123', { serverUrl: 'http://custom:8080' });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
    });
  });

  describe('Error cases', () => {
    test('should error when id is missing', async () => {
      await artifactRestart(undefined, {});

      expect(mockPost).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);

      const calls = consoleErrorSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Artifact ID is required'))).toBe(true);
    });

    test('should handle network error', async () => {
      mockPost.mockRejectedValue(new Error('Connection failed'));

      await artifactRestart('artifact-123', {});

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
