/**
 * Unit tests for MinimalTheme
 * Target: 100% coverage
 */

import { describe, test, expect } from 'vitest';
import { MinimalTheme } from '../../../src/themes/MinimalTheme.js';

describe('MinimalTheme', () => {
  test('should have correct name', () => {
    expect(MinimalTheme.name).toBe('minimal');
  });

  describe('Color functions (identity)', () => {
    test('should not modify text with primary', () => {
      expect(MinimalTheme.colors.primary('test')).toBe('test');
    });

    test('should not modify text with secondary', () => {
      expect(MinimalTheme.colors.secondary('test')).toBe('test');
    });

    test('should not modify text with success', () => {
      expect(MinimalTheme.colors.success('test')).toBe('test');
    });

    test('should not modify text with error', () => {
      expect(MinimalTheme.colors.error('test')).toBe('test');
    });

    test('should not modify text with warning', () => {
      expect(MinimalTheme.colors.warning('test')).toBe('test');
    });

    test('should not modify text with info', () => {
      expect(MinimalTheme.colors.info('test')).toBe('test');
    });

    test('should not modify text with muted', () => {
      expect(MinimalTheme.colors.muted('test')).toBe('test');
    });

    test('should not modify text with highlight', () => {
      expect(MinimalTheme.colors.highlight('test')).toBe('test');
    });
  });

  describe('Icons (ASCII)', () => {
    test('should have ASCII success icon', () => {
      expect(MinimalTheme.icons.success).toBe('[OK]');
    });

    test('should have ASCII error icon', () => {
      expect(MinimalTheme.icons.error).toBe('[ERROR]');
    });

    test('should have ASCII warning icon', () => {
      expect(MinimalTheme.icons.warning).toBe('[WARN]');
    });

    test('should have ASCII info icon', () => {
      expect(MinimalTheme.icons.info).toBe('[INFO]');
    });

    test('should have ASCII loading icon', () => {
      expect(MinimalTheme.icons.loading).toBe('[...]');
    });
  });
});
