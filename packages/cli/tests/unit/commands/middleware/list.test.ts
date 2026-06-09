/**
 * Unit tests for middleware/list command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { middlewareList } from '../../../../src/commands/middleware/list.js';
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

describe('middlewareList command', () => {
  let mockGet: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockMiddlewareData = {
    middleware: {
      errorClassifier: true,
      retry: true,
      mentorship: false
    },
    enabledCount: 2
  };

  beforeEach(() => {
    (ConfigManager.load as any).mockResolvedValue({ serverUrl: 'http://localhost:4000' });
    mockGet = vi.fn().mockResolvedValue(mockMiddlewareData);

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
    test('should list all middleware systems', async () => {
      await middlewareList({});

      expect(mockGet).toHaveBeenCalledWith('/middleware/config');
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('Middleware Systems'))).toBe(true);
    });

    test('should display middleware names', async () => {
      await middlewareList({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('Error Classifier'))).toBe(true);
      expect(calls.some((c: string) => c.includes('Retry'))).toBe(true);
      expect(calls.some((c: string) => c.includes('Mentorship'))).toBe(true);
    });

    test('should display enabled/disabled status', async () => {
      await middlewareList({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('Enabled'))).toBe(true);
      expect(calls.some((c: string) => c.includes('Disabled'))).toBe(true);
    });

    test('should display management hints', async () => {
      await middlewareList({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('cortex middleware status'))).toBe(true);
      expect(calls.some((c: string) => c.includes('cortex middleware enable'))).toBe(true);
      expect(calls.some((c: string) => c.includes('cortex middleware disable'))).toBe(true);
      expect(calls.some((c: string) => c.includes('cortex middleware config'))).toBe(true);
    });

    test('should handle empty middleware list', async () => {
      mockGet.mockResolvedValue({ middleware: {}, enabledCount: 0 });

      await middlewareList({});

      const calls = consoleLogSpy.mock.calls.map((c: any) => c.join(' '));

      expect(calls.some((c: string) => c.includes('No middleware systems found'))).toBe(true);
    });

    test('should output JSON format when requested', async () => {
      await middlewareList({ json: true });

      expect(consoleLogSpy).toHaveBeenCalledOnce();

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.middleware).toBeDefined();
      expect(parsed.enabledCount).toBe(2);
    });

    test('should use custom serverUrl when provided', async () => {
      await middlewareList({ serverUrl: 'http://custom:8080' });

      expect(CortexClient).toHaveBeenCalledWith('http://custom:8080');
    });
  });

  describe('Error cases', () => {
    test('should handle network error', async () => {
      mockGet.mockRejectedValue(new Error('Connection failed'));

      await middlewareList({});

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
