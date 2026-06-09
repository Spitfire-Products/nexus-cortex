/**
 * Unit tests for middleware/status command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { middlewareStatus } from '../../../../src/commands/middleware/status.js';
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

describe('middlewareStatus command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockStatusData = {
    name: 'Retry',
    enabled: true,
    description: 'Retries failed operations',
    order: 2,
    config: {
      maxRetries: 3,
      backoffMs: 1000,
      exponential: true
    },
    stats: {
      invocations: 150,
      successes: 135,
      failures: 15,
      avgDuration: 250
    }
  };

  beforeEach(() => {
    (ConfigManager.load as any).mockResolvedValue({ serverUrl: 'http://localhost:4000' });
    mockGet = vi.fn().mockResolvedValue(mockStatusData);

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
    test('should show middleware status', async () => {
      await middlewareStatus('retry', {});

      expect(mockGet).toHaveBeenCalledWith('/middleware/retry/status');
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('Middleware: Retry'))).toBe(true);
    });

    test('should display enabled status', async () => {
      await middlewareStatus('retry', {});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('Enabled'))).toBe(true);
    });

    test('should display configuration', async () => {
      await middlewareStatus('retry', {});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('Configuration'))).toBe(true);
      expect(calls.some((c: string) => c.includes('maxRetries'))).toBe(true);
      expect(calls.some((c: string) => c.includes('3'))).toBe(true);
    });

    test('should display statistics', async () => {
      await middlewareStatus('retry', {});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('Statistics'))).toBe(true);
      expect(calls.some((c: string) => c.includes('Invocations'))).toBe(true);
      expect(calls.some((c: string) => c.includes('150'))).toBe(true);
      expect(calls.some((c: string) => c.includes('250ms'))).toBe(true);
    });

    test('should display management hints', async () => {
      await middlewareStatus('retry', {});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('cortex middleware disable retry'))).toBe(true);
      expect(calls.some((c: string) => c.includes('cortex middleware config retry'))).toBe(true);
    });

    test('should output JSON format when requested', async () => {
      await middlewareStatus('retry', { json: true });

      expect(consoleLogSpy).toHaveBeenCalledOnce();

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.name).toBe('Retry');
      expect(parsed.enabled).toBe(true);
    });

    test('should use custom serverUrl when provided', async () => {
      await middlewareStatus('retry', { serverUrl: 'http://custom:8080' });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
    });
  });

  describe('Error cases', () => {
    test('should error when name is missing', async () => {
      await middlewareStatus(undefined, {});

      expect(mockGet).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);

      const calls = consoleErrorSpy.mock.calls.map((c: any) => c.join(' '));
      expect(calls.some((c: string) => c.includes('Middleware name is required'))).toBe(true);
    });

    test('should handle network error', async () => {
      mockGet.mockRejectedValue(new Error('Connection failed'));

      await middlewareStatus('retry', {});

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
