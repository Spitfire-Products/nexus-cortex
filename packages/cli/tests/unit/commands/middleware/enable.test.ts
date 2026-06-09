/**
 * Unit tests for middleware/enable command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { middlewareEnable } from '../../../../src/commands/middleware/enable.js';
import { CortexClient } from '../../../../src/client/CortexClient.js';

vi.mock('../../../../src/client/CortexClient.js', () => ({
  CortexClient: vi.fn()
}));

vi.mock('../../../../src/config/ConfigManager.js', () => ({
  ConfigManager: {
    load: vi.fn().mockResolvedValue({ serverUrl: 'http://localhost:4000' }),
    get: vi.fn().mockReturnValue(undefined),
    clearCache: vi.fn()
  }
}));

import { ConfigManager } from '../../../../src/config/ConfigManager.js';

describe('middlewareEnable command', () => {
  let mockPost: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockResponseData = {
    message: 'Middleware enabled successfully'
  };

  beforeEach(() => {
    (ConfigManager.load as any).mockResolvedValue({ serverUrl: 'http://localhost:4000' });
    mockPost = vi.fn().mockResolvedValue(mockResponseData);

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
    test('should enable middleware', async () => {
      await middlewareEnable('mentorship', {});

      expect(mockPost).toHaveBeenCalledWith('/middleware/mentorship/enable', {});
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('Middleware enabled successfully'))).toBe(true);
      expect(calls.some((c: string) => c.includes('mentorship'))).toBe(true);
    });

    test('should display status hint', async () => {
      await middlewareEnable('retry', {});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('cortex middleware status retry'))).toBe(true);
    });

    test('should output JSON format when requested', async () => {
      await middlewareEnable('retry', { json: true });

      expect(consoleLogSpy).toHaveBeenCalledOnce();

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.message).toContain('enabled');
    });

    test('should use custom serverUrl when provided', async () => {
      await middlewareEnable('retry', { serverUrl: 'http://custom:8080' });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
    });
  });

  describe('Error cases', () => {
    test('should error when name is missing', async () => {
      await middlewareEnable(undefined, {});

      expect(mockPost).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);

      const calls = consoleErrorSpy.mock.calls.map((c: any) => c.join(' '));
      expect(calls.some((c: string) => c.includes('Middleware name is required'))).toBe(true);
    });

    test('should handle network error', async () => {
      mockPost.mockRejectedValue(new Error('Connection failed'));

      await middlewareEnable('retry', {});

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
