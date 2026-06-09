/**
 * Unit tests for config/categories command
 * Target: 80%+ coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configCategories } from '../../../../src/commands/config/categories.js';

describe('configCategories command', () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Success cases', () => {
    test('should display all categories', async () => {
      await configCategories();

      expect(consoleLogSpy).toHaveBeenCalled();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Configuration Categories'))).toBe(true);
      expect(calls.some(c => c.includes('Connection'))).toBe(true);
      expect(calls.some(c => c.includes('Preferences'))).toBe(true);
    });

    test('should show category descriptions', async () => {
      await configCategories();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('Server connection settings'))).toBe(true);
      expect(calls.some(c => c.includes('User preferences'))).toBe(true);
    });

    test('should show setting counts', async () => {
      await configCategories();

      const calls = consoleLogSpy.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('settings'))).toBe(true);
    });

    test('should output JSON when requested', async () => {
      await configCategories({ json: true });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.connection).toBeDefined();
      expect(parsed.preferences).toBeDefined();
    });
  });

  describe('Error cases', () => {
    test('should handle unexpected errors gracefully', async () => {
      // Force an error by mocking ThemeManager
      const originalLog = console.log;
      consoleLogSpy.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      await configCategories();

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
