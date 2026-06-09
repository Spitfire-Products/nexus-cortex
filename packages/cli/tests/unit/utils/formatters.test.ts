/**
 * Unit tests for formatters utility
 * Target: 100% coverage
 */

import { describe, test, expect } from 'vitest';
import {
  formatBytes,
  formatDate,
  formatRelativeTime,
  formatNumber,
  formatCompactNumber,
  formatTokens,
  formatPercentage,
  formatContextWindow,
  formatPrice
} from '../../../src/utils/formatters.js';

describe('formatBytes', () => {
  test('should format bytes (< 1024)', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  test('should format kilobytes (1024 - 1MB)', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(2560)).toBe('2.5 KB');
    expect(formatBytes(1048575)).toBe('1024.0 KB');
  });

  test('should format megabytes (>= 1MB)', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(2097152)).toBe('2.0 MB');
    expect(formatBytes(5242880)).toBe('5.0 MB');
    expect(formatBytes(1258291)).toBe('1.2 MB');
  });
});

describe('formatDate', () => {
  test('should format Date object', () => {
    const date = new Date('2025-01-14T20:00:00Z');
    const result = formatDate(date);
    // Result will vary by locale, but should contain date components
    expect(result).toContain('2025');
  });

  test('should format ISO string', () => {
    const result = formatDate('2025-01-14T20:00:00Z');
    expect(result).toContain('2025');
  });

  test('should handle invalid date string', () => {
    expect(formatDate('not-a-date')).toBe('Invalid Date');
  });

  test('should handle invalid Date object', () => {
    expect(formatDate(new Date('invalid'))).toBe('Invalid Date');
  });
});

describe('formatRelativeTime', () => {
  test('should return "just now" for recent times', () => {
    const now = new Date();
    const fiveSecondsAgo = new Date(now.getTime() - 5000);
    expect(formatRelativeTime(fiveSecondsAgo)).toBe('just now');
  });

  test('should format seconds ago', () => {
    const now = new Date();
    const thirtySecondsAgo = new Date(now.getTime() - 30000);
    expect(formatRelativeTime(thirtySecondsAgo)).toBe('30 seconds ago');
  });

  test('should format minutes ago (singular)', () => {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);
    expect(formatRelativeTime(oneMinuteAgo)).toBe('1 minute ago');
  });

  test('should format minutes ago (plural)', () => {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 300000);
    expect(formatRelativeTime(fiveMinutesAgo)).toBe('5 minutes ago');
  });

  test('should format hours ago (singular)', () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    expect(formatRelativeTime(oneHourAgo)).toBe('1 hour ago');
  });

  test('should format hours ago (plural)', () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 7200000);
    expect(formatRelativeTime(twoHoursAgo)).toBe('2 hours ago');
  });

  test('should format days ago (singular)', () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 86400000);
    expect(formatRelativeTime(oneDayAgo)).toBe('1 day ago');
  });

  test('should format days ago (plural)', () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 259200000);
    expect(formatRelativeTime(threeDaysAgo)).toBe('3 days ago');
  });

  test('should format weeks ago (singular)', () => {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 604800000);
    expect(formatRelativeTime(oneWeekAgo)).toBe('1 week ago');
  });

  test('should format weeks ago (plural)', () => {
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 1209600000);
    expect(formatRelativeTime(twoWeeksAgo)).toBe('2 weeks ago');
  });

  test('should handle invalid date', () => {
    expect(formatRelativeTime('invalid')).toBe('Invalid Date');
  });
});

describe('formatNumber', () => {
  test('should format numbers with commas', () => {
    expect(formatNumber(1500)).toBe('1,500');
    expect(formatNumber(1000000)).toBe('1,000,000');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  test('should handle zero', () => {
    expect(formatNumber(0)).toBe('0');
  });
});

describe('formatCompactNumber', () => {
  test('should format numbers < 1000 as-is', () => {
    expect(formatCompactNumber(0)).toBe('0');
    expect(formatCompactNumber(256)).toBe('256');
    expect(formatCompactNumber(999)).toBe('999');
  });

  test('should format thousands with k suffix', () => {
    expect(formatCompactNumber(1000)).toBe('1.0k');
    expect(formatCompactNumber(1500)).toBe('1.5k');
    expect(formatCompactNumber(999999)).toBe('1000.0k');
  });

  test('should format millions with M suffix', () => {
    expect(formatCompactNumber(1000000)).toBe('1.0M');
    expect(formatCompactNumber(2500000)).toBe('2.5M');
    expect(formatCompactNumber(999999999)).toBe('1000.0M');
  });

  test('should format billions with B suffix', () => {
    expect(formatCompactNumber(1000000000)).toBe('1.0B');
    expect(formatCompactNumber(1500000000)).toBe('1.5B');
  });
});

describe('formatTokens', () => {
  test('should format tokens < 1000 as-is', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(256)).toBe('256');
    expect(formatTokens(999)).toBe('999');
  });

  test('should format thousands with k suffix', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(999999)).toBe('1000.0k');
  });

  test('should format millions with M suffix', () => {
    expect(formatTokens(1000000)).toBe('1.0M');
    expect(formatTokens(1200000)).toBe('1.2M');
  });
});

describe('formatPercentage', () => {
  test('should format percentages correctly', () => {
    expect(formatPercentage(75, 100)).toBe('75.0%');
    expect(formatPercentage(50, 200)).toBe('25.0%');
    expect(formatPercentage(755, 1000)).toBe('75.5%');
  });

  test('should handle 0%', () => {
    expect(formatPercentage(0, 100)).toBe('0.0%');
  });

  test('should handle 100%', () => {
    expect(formatPercentage(100, 100)).toBe('100.0%');
  });

  test('should handle total of 0', () => {
    expect(formatPercentage(50, 0)).toBe('0.0%');
  });
});

describe('formatContextWindow', () => {
  test('should format small numbers as-is', () => {
    expect(formatContextWindow(256)).toBe('256');
    expect(formatContextWindow(999)).toBe('999');
  });

  test('should format thousands with K suffix', () => {
    expect(formatContextWindow(1000)).toBe('1K');
    expect(formatContextWindow(128000)).toBe('128K');
    expect(formatContextWindow(200000)).toBe('200K');
  });

  test('should format millions with M suffix', () => {
    expect(formatContextWindow(1000000)).toBe('1M');
    expect(formatContextWindow(2000000)).toBe('2M');
  });
});

describe('formatPrice', () => {
  test('should format prices with 2 decimal places', () => {
    expect(formatPrice(0.076)).toBe('$0.08');
    expect(formatPrice(15.0)).toBe('$15.00');
    expect(formatPrice(3.5)).toBe('$3.50');
  });

  test('should handle zero', () => {
    expect(formatPrice(0)).toBe('$0.00');
  });

  test('should round correctly', () => {
    expect(formatPrice(0.074)).toBe('$0.07');
    expect(formatPrice(0.075)).toBe('$0.07'); // Floating-point precision rounds down
    expect(formatPrice(0.076)).toBe('$0.08');
  });
});
