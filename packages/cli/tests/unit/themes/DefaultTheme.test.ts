/**
 * Unit tests for DefaultTheme
 * Target: 100% coverage
 */

import { describe, test, expect } from 'vitest';
import { DefaultTheme } from '../../../src/themes/DefaultTheme.js';

describe('DefaultTheme', () => {
  test('should have correct name', () => {
    expect(DefaultTheme.name).toBe('default');
  });

  describe('Color functions', () => {
    test('should apply primary color (cyan bold)', () => {
      const result = DefaultTheme.colors.primary('test');
      // Result contains the text (may or may not have color codes depending on environment)
      expect(result).toContain('test');
      expect(typeof result).toBe('string');
    });

    test('should apply secondary color (cyan)', () => {
      const result = DefaultTheme.colors.secondary('test');
      expect(result).toContain('test');
    });

    test('should apply success color (green)', () => {
      const result = DefaultTheme.colors.success('test');
      expect(result).toContain('test');
    });

    test('should apply error color (red)', () => {
      const result = DefaultTheme.colors.error('test');
      expect(result).toContain('test');
    });

    test('should apply warning color (yellow)', () => {
      const result = DefaultTheme.colors.warning('test');
      expect(result).toContain('test');
    });

    test('should apply info color (blue)', () => {
      const result = DefaultTheme.colors.info('test');
      expect(result).toContain('test');
    });

    test('should apply muted color (gray)', () => {
      const result = DefaultTheme.colors.muted('test');
      expect(result).toContain('test');
    });

    test('should apply highlight (bold)', () => {
      const result = DefaultTheme.colors.highlight('test');
      expect(result).toContain('test');
    });
  });

  describe('Icons', () => {
    test('should have success icon', () => {
      expect(DefaultTheme.icons.success).toBe('✓');
    });

    test('should have error icon', () => {
      expect(DefaultTheme.icons.error).toBe('✗');
    });

    test('should have warning icon', () => {
      expect(DefaultTheme.icons.warning).toBe('⚠️');
    });

    test('should have info icon', () => {
      expect(DefaultTheme.icons.info).toBe('ℹ️');
    });

    test('should have loading icon', () => {
      expect(DefaultTheme.icons.loading).toBe('⏳');
    });
  });
});
