/**
 * Unit tests for config/get command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configGet } from '../../../../src/commands/config/get.js';
import { ConfigManager } from '../../../../src/config/ConfigManager.js';

// Mock ConfigManager
vi.mock('../../../../src/config/ConfigManager.js', () => {
  return {
    ConfigManager: {
      get: vi.fn().mockReturnValue('default'),
      load: vi.fn()
    }
  };
});

describe('configGet command', () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  const mockConfig = {
    serverUrl: 'http://localhost:4000',
    defaultModel: 'claude-sonnet-4-5',
    theme: 'default' as const,
    timeout: 30000,
    maxRetries: 3,
    logLevel: 'error' as const
  };

  beforeEach(() => {
    (ConfigManager.load as any).mockReturnValue(mockConfig);

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Success cases', () => {
    test('should display all config when no key provided', async () => {
      await configGet();

      expect(ConfigManager.load).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Configuration'))).toBe(true);
      expect(calls.some(c => c.includes('serverUrl'))).toBe(true);
      expect(calls.some(c => c.includes('defaultModel'))).toBe(true);
    });

    test('should display specific config key', async () => {
      await configGet('serverUrl');

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('serverUrl') && c.includes('http://localhost:4000'))).toBe(true);
    });

    test('should output JSON when requested', async () => {
      await configGet(undefined, { json: true });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.serverUrl).toBe('http://localhost:4000');
    });

    test('should output JSON for single key', async () => {
      await configGet('theme', { json: true });

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.theme).toBe('default');
    });

    test('should handle optional defaultModel', async () => {
      (ConfigManager.load as any).mockReturnValue({
        ...mockConfig,
        defaultModel: undefined
      });

      await configGet();

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('Error cases', () => {
    test('should error on unknown config key', async () => {
      await configGet('unknownKey');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
      const calls = consoleErrorSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Unknown config key'))).toBe(true);
    });

    test('should handle ConfigManager.load errors', async () => {
      (ConfigManager.load as any).mockImplementation(() => {
        throw new Error('Config file corrupted');
      });

      await configGet();

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
