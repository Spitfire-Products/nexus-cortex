/**
 * Unit tests for ThemeManager
 * Target: 100% coverage
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ThemeManager } from '../../../src/themes/ThemeManager.js';
import { DefaultTheme } from '../../../src/themes/DefaultTheme.js';
import { MinimalTheme } from '../../../src/themes/MinimalTheme.js';

vi.mock('../../../src/ink-ui/colors.js', () => ({
  persistTheme: vi.fn(),
  loadPersistedTheme: vi.fn(),
  persistThemeForPlatform: vi.fn(),
  loadPersistedThemeForPlatform: vi.fn(),
}));

import { persistTheme, loadPersistedTheme } from '../../../src/ink-ui/colors.js';

describe('ThemeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ThemeManager.clearCache();
  });

  describe('setTheme()', () => {
    test('should set default theme', async () => {
      await ThemeManager.setTheme('default');

      expect(persistTheme).toHaveBeenCalledWith('default');
    });

    test('should set minimal theme', async () => {
      await ThemeManager.setTheme('minimal');

      expect(persistTheme).toHaveBeenCalledWith('minimal');
    });

    test('should throw on invalid theme', async () => {
      await expect(
        ThemeManager.setTheme('invalid' as any)
      ).rejects.toThrow('Invalid theme: invalid');
    });
  });

  describe('getTheme()', () => {
    test('should get default theme when persisted is default', () => {
      vi.mocked(loadPersistedTheme).mockReturnValue('default' as any);

      const theme = ThemeManager.getTheme();

      expect(theme).toEqual(DefaultTheme);
    });

    test('should get minimal theme when persisted is minimal', () => {
      vi.mocked(loadPersistedTheme).mockReturnValue('minimal' as any);

      const theme = ThemeManager.getTheme();

      expect(theme).toEqual(MinimalTheme);
    });

    test('should default to default theme for null', () => {
      vi.mocked(loadPersistedTheme).mockReturnValue(null as any);

      const theme = ThemeManager.getTheme();

      expect(theme).toEqual(DefaultTheme);
    });
  });

  describe('applyTheme()', () => {
    test('should apply custom theme', () => {
      ThemeManager.applyTheme(MinimalTheme);

      vi.mocked(loadPersistedTheme).mockReturnValue('minimal' as any);
      const theme = ThemeManager.getTheme();
      expect(theme).toEqual(MinimalTheme);
    });

    test('should apply default theme', () => {
      ThemeManager.applyTheme(DefaultTheme);

      vi.mocked(loadPersistedTheme).mockReturnValue('default' as any);
      const theme = ThemeManager.getTheme();
      expect(theme).toEqual(DefaultTheme);
    });
  });

  describe('getThemeByName()', () => {
    test('should get default theme by name', () => {
      const theme = ThemeManager.getThemeByName('default');
      expect(theme).toEqual(DefaultTheme);
    });

    test('should get minimal theme by name', () => {
      const theme = ThemeManager.getThemeByName('minimal');
      expect(theme).toEqual(MinimalTheme);
    });
  });
});
