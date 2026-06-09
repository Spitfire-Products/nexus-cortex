/**
 * Unit tests for artifact/stop command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { artifactStop } from '../../../../src/commands/artifact/stop.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

// Mock the CortexClient
vi.mock('../../../../src/client/CortexClient.js', () => {
  return {
    CortexClient: vi.fn()
  };
});

describe('artifactStop command', () => {
  let mockPost: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockStopData = {
    message: 'Artifact stopped successfully'
  };

  beforeEach(() => {
    mockPost = vi.fn().mockResolvedValue(mockStopData);

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
    test('should stop artifact', async () => {
      await artifactStop('artifact-123', {});

      expect(mockPost).toHaveBeenCalledWith('/artifact/stop', { id: 'artifact-123' });
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Artifact stopped successfully'))).toBe(true);
    });

    test('should display restart instructions', async () => {
      await artifactStop('artifact-123', {});

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Restart with'))).toBe(true);
      expect(calls.some(c => c.includes('cortex artifact restart'))).toBe(true);
    });

    test('should output JSON format when requested', async () => {
      await artifactStop('artifact-123', { json: true });

      expect(consoleLogSpy).toHaveBeenCalledOnce();

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.message).toBeDefined();
    });

    test('should use custom serverUrl when provided', async () => {
      await artifactStop('artifact-123', { serverUrl: 'http://custom:8080' });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
    });
  });

  describe('Error cases', () => {
    test('should error when id is missing', async () => {
      await artifactStop(undefined, {});

      expect(mockPost).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);

      const calls = consoleErrorSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Artifact ID is required'))).toBe(true);
    });

    test('should handle network error', async () => {
      mockPost.mockRejectedValue(new Error('Connection failed'));

      await artifactStop('artifact-123', {});

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
