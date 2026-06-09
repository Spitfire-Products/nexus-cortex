/**
 * Unit tests for config/set command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configSet } from '../../../../src/commands/config/set.js';
import { ConfigManager } from '../../../../src/config/ConfigManager.js';

// Mock ConfigManager
vi.mock('../../../../src/config/ConfigManager.js', () => {
  return {
    ConfigManager: {
      get: vi.fn().mockReturnValue('default'),
      set: vi.fn()
    }
  };
});

describe('configSet command', () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    (ConfigManager.set as any).mockResolvedValue(undefined);

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Success cases', () => {
    test('should set serverUrl', async () => {
      await configSet('serverUrl', 'http://custom:5000');

      expect(ConfigManager.set).toHaveBeenCalledWith('serverUrl', 'http://custom:5000');
      expect(consoleLogSpy).toHaveBeenCalled();
      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Configuration updated'))).toBe(true);
    });

    test('should set defaultModel', async () => {
      await configSet('defaultModel', 'gpt-4o');

      expect(ConfigManager.set).toHaveBeenCalledWith('defaultModel', 'gpt-4o');
    });

    test('should set theme', async () => {
      await configSet('theme', 'minimal');

      expect(ConfigManager.set).toHaveBeenCalledWith('theme', 'minimal');
    });

    test('should set timeout (number)', async () => {
      await configSet('timeout', '60000');

      expect(ConfigManager.set).toHaveBeenCalledWith('timeout', 60000);
    });

    test('should set maxRetries (number)', async () => {
      await configSet('maxRetries', '5');

      expect(ConfigManager.set).toHaveBeenCalledWith('maxRetries', 5);
    });

    test('should set logLevel', async () => {
      await configSet('logLevel', 'debug');

      expect(ConfigManager.set).toHaveBeenCalledWith('logLevel', 'debug');
    });
  });

  describe('Validation cases', () => {
    test('should reject unknown config key', async () => {
      await configSet('unknownKey', 'value');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
      const calls = consoleErrorSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Unknown config key'))).toBe(true);
    });

    test('should reject invalid theme', async () => {
      await configSet('theme', 'invalid');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should reject invalid logLevel', async () => {
      await configSet('logLevel', 'invalid');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should reject non-number for timeout', async () => {
      await configSet('timeout', 'notanumber');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should reject timeout out of range (too low)', async () => {
      await configSet('timeout', '500');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should reject timeout out of range (too high)', async () => {
      await configSet('timeout', '700000');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should reject maxRetries out of range (too low)', async () => {
      await configSet('maxRetries', '-1');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should reject maxRetries out of range (too high)', async () => {
      await configSet('maxRetries', '20');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    test('should reject invalid serverUrl (no protocol)', async () => {
      await configSet('serverUrl', 'localhost:4000');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('Error cases', () => {
    test('should handle ConfigManager.set errors', async () => {
      (ConfigManager.set as any).mockRejectedValue(new Error('Write failed'));

      await configSet('serverUrl', 'http://test:4000');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
