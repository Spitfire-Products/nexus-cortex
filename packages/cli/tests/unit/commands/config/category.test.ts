/**
 * Unit tests for config/category command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configCategory } from '../../../../src/commands/config/category.js';
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

describe('configCategory command', () => {
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
    test('should display connection category settings', async () => {
      await configCategory('connection');

      expect(ConfigManager.load).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Connection Configuration'))).toBe(true);
      expect(calls.some(c => c.includes('serverUrl'))).toBe(true);
      expect(calls.some(c => c.includes('timeout'))).toBe(true);
      expect(calls.some(c => c.includes('maxRetries'))).toBe(true);
    });

    test('should display preferences category settings', async () => {
      await configCategory('preferences');

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Preferences Configuration'))).toBe(true);
      expect(calls.some(c => c.includes('theme'))).toBe(true);
      expect(calls.some(c => c.includes('defaultModel'))).toBe(true);
      expect(calls.some(c => c.includes('logLevel'))).toBe(true);
    });

    test('should be case-insensitive for category names', async () => {
      await configCategory('CONNECTION');

      expect(consoleLogSpy).toHaveBeenCalled();
      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Connection Configuration'))).toBe(true);
    });

    test('should output JSON when requested', async () => {
      await configCategory('connection', { json: true });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.serverUrl).toBe('http://localhost:4000');
      expect(parsed.timeout).toBe(30000);
      expect(parsed.maxRetries).toBe(3);
    });

    test('should handle undefined config values', async () => {
      (ConfigManager.load as any).mockReturnValue({
        ...mockConfig,
        defaultModel: undefined
      });

      await configCategory('preferences');

      expect(consoleLogSpy).toHaveBeenCalled();
      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('defaultModel'))).toBe(true);
    });
  });

  describe('Error cases', () => {
    test('should error on unknown category', async () => {
      await configCategory('unknown');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
      const calls = consoleErrorSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Unknown category'))).toBe(true);
    });

    test('should list available categories on error', async () => {
      await configCategory('invalid');

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Available categories'))).toBe(true);
      expect(calls.some(c => c.includes('connection'))).toBe(true);
      expect(calls.some(c => c.includes('preferences'))).toBe(true);
    });

    test('should handle ConfigManager.load errors', async () => {
      (ConfigManager.load as any).mockImplementation(() => {
        throw new Error('Config file corrupted');
      });

      await configCategory('connection');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
