/**
 * Unit tests for middleware/config command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { middlewareConfig } from '../../../../src/commands/middleware/config.js';
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

describe('middlewareConfig command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockAllConfigData = {
    middleware: { retry: true },
    config: {
      retry: {
        maxRetries: 3,
        backoffMs: 1000,
        exponential: true
      }
    },
    envVars: {
      retry: [
        {
          name: 'MAX_RETRIES',
          value: '3',
          description: 'Maximum number of retry attempts',
          default: 3
        },
        {
          name: 'RETRY_BACKOFF_MS',
          value: null,
          description: 'Backoff delay in milliseconds',
          default: 1000
        }
      ]
    },
    defaults: {
      retry: {
        maxRetries: 3,
        exponential: true
      }
    }
  };

  beforeEach(() => {
    (ConfigManager.load as any).mockResolvedValue({ serverUrl: 'http://localhost:4000' });
    mockGet = vi.fn().mockResolvedValue(mockAllConfigData);

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
    test('should show middleware configuration', async () => {
      await middlewareConfig('retry', {});

      expect(mockGet).toHaveBeenCalledWith('/middleware/config');
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('Middleware Configuration: retry'))).toBe(true);
    });

    test('should display current configuration', async () => {
      await middlewareConfig('retry', {});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('Current Configuration'))).toBe(true);
      expect(calls.some((c: string) => c.includes('maxRetries'))).toBe(true);
      expect(calls.some((c: string) => c.includes('3'))).toBe(true);
    });

    test('should display environment variables', async () => {
      await middlewareConfig('retry', {});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('Environment Variables'))).toBe(true);
      expect(calls.some((c: string) => c.includes('MAX_RETRIES'))).toBe(true);
      expect(calls.some((c: string) => c.includes('Set'))).toBe(true);
      expect(calls.some((c: string) => c.includes('Not set'))).toBe(true);
    });

    test('should display default values', async () => {
      await middlewareConfig('retry', {});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('Default Values'))).toBe(true);
    });

    test('should handle empty configuration', async () => {
      mockGet.mockResolvedValue({ middleware: {}, config: {}, envVars: {}, defaults: {} });

      await middlewareConfig('test', {});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('No configuration settings available'))).toBe(true);
    });

    test('should display management hints', async () => {
      await middlewareConfig('retry', {});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('cortex middleware status retry'))).toBe(true);
      expect(calls.some((c: string) => c.includes('cortex middleware enable retry'))).toBe(true);
      expect(calls.some((c: string) => c.includes('cortex middleware disable retry'))).toBe(true);
    });

    test('should output JSON format when requested', async () => {
      await middlewareConfig('retry', { json: true });

      expect(consoleLogSpy).toHaveBeenCalledOnce();

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.name).toBe('retry');
      expect(parsed.config).toBeDefined();
    });

    test('should use custom serverUrl when provided', async () => {
      await middlewareConfig('retry', { serverUrl: 'http://custom:8080' });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
    });
  });

  describe('Error cases', () => {
    test('should error when name is missing', async () => {
      await middlewareConfig(undefined, {});

      expect(mockGet).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);

      const calls = consoleErrorSpy.mock.calls.map((c: any) => c.join(' '));
      expect(calls.some((c: string) => c.includes('Middleware name is required'))).toBe(true);
    });

    test('should handle network error', async () => {
      mockGet.mockRejectedValue(new Error('Connection failed'));

      await middlewareConfig('retry', {});

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
