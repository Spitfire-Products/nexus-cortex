/**
 * Utility functions for formatting data for display
 *
 * This module provides consistent formatting for numbers, dates, sizes, and prices
 * across all CLI commands. All formatters handle edge cases gracefully.
 *
 * @module formatters
 */

/**
 * Formats byte sizes into human-readable format with appropriate units.
 *
 * Converts raw byte counts into B (bytes), KB (kilobytes), or MB (megabytes)
 * with 1 decimal place of precision for KB and MB.
 *
 * @param bytes - The number of bytes to format
 * @returns Formatted string with unit suffix
 *
 * @example
 * ```typescript
 * formatBytes(512)      // → "512 B"
 * formatBytes(1024)     // → "1.0 KB"
 * formatBytes(2560)     // → "2.5 KB"
 * formatBytes(1048576)  // → "1.0 MB"
 * formatBytes(5242880)  // → "5.0 MB"
 * ```
 *
 * @see {@link https://en.wikipedia.org/wiki/Byte | Byte on Wikipedia}
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

/**
 * Formats dates into locale-aware strings.
 *
 * Accepts either Date objects or ISO 8601 strings and converts them to
 * a locale-appropriate format using the system's default locale.
 * Returns "Invalid Date" for any invalid input.
 *
 * @param date - Date object or ISO 8601 string to format
 * @returns Locale-formatted date string, or "Invalid Date" if input is invalid
 *
 * @example
 * ```typescript
 * formatDate(new Date('2025-01-14T20:00:00Z'))
 * // → "1/14/2025, 8:00:00 PM" (en-US locale)
 *
 * formatDate('2025-01-14T20:00:00Z')
 * // → "1/14/2025, 8:00:00 PM"
 *
 * formatDate('not-a-date')
 * // → "Invalid Date"
 * ```
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleString | Date.toLocaleString()}
 */
export function formatDate(date: Date | string): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  if (isNaN(dateObj.getTime())) {
    return 'Invalid Date';
  }

  return dateObj.toLocaleString();
}

/**
 * Formats dates as relative time strings (e.g., "5 minutes ago").
 *
 * Calculates the time difference between the given date and now, then
 * formats it in a human-readable relative format with automatic pluralization.
 * Returns "Invalid Date" for any invalid input.
 *
 * Time ranges:
 * - < 10 seconds: "just now"
 * - < 60 seconds: "{n} seconds ago"
 * - < 60 minutes: "{n} minute(s) ago"
 * - < 24 hours: "{n} hour(s) ago"
 * - < 7 days: "{n} day(s) ago"
 * - >= 7 days: "{n} week(s) ago"
 *
 * @param date - Date object or ISO 8601 string to format
 * @returns Relative time string, or "Invalid Date" if input is invalid
 *
 * @example
 * ```typescript
 * // Assuming current time is 2025-01-14 20:00:00
 *
 * formatRelativeTime(new Date('2025-01-14 19:59:55'))
 * // → "just now" (5 seconds ago)
 *
 * formatRelativeTime(new Date('2025-01-14 19:30:00'))
 * // → "30 minutes ago"
 *
 * formatRelativeTime(new Date('2025-01-14 18:00:00'))
 * // → "2 hours ago"
 *
 * formatRelativeTime(new Date('2025-01-13 20:00:00'))
 * // → "1 day ago"
 * ```
 */
export function formatRelativeTime(date: Date | string): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  if (isNaN(dateObj.getTime())) {
    return 'Invalid Date';
  }

  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffSeconds < 10) {
    return 'just now';
  } else if (diffSeconds < 60) {
    return `${diffSeconds} seconds ago`;
  } else if (diffMinutes < 60) {
    return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
  } else if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  } else if (diffDays < 7) {
    return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
  } else {
    return diffWeeks === 1 ? '1 week ago' : `${diffWeeks} weeks ago`;
  }
}

/**
 * Formats numbers with thousands separators for readability.
 *
 * Uses the en-US locale to add comma separators every three digits.
 * Handles negative numbers and zero correctly.
 *
 * @param num - The number to format
 * @returns Formatted string with comma separators
 *
 * @example
 * ```typescript
 * formatNumber(1234)      // → "1,234"
 * formatNumber(1000000)   // → "1,000,000"
 * formatNumber(999)       // → "999"
 * formatNumber(0)         // → "0"
 * formatNumber(-1234)     // → "-1,234"
 * ```
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/toLocaleString | Number.toLocaleString()}
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Formats numbers in compact form with k/M/B suffixes.
 *
 * Converts large numbers into human-readable compact form with one decimal
 * place of precision. Useful for displaying statistics in limited space.
 *
 * Ranges:
 * - < 1,000: As-is (no suffix)
 * - 1,000 - 999,999: Thousands with 'k' suffix
 * - 1,000,000 - 999,999,999: Millions with 'M' suffix
 * - >= 1,000,000,000: Billions with 'B' suffix
 *
 * @param num - The number to format
 * @returns Compact formatted string with suffix
 *
 * @example
 * ```typescript
 * formatCompactNumber(999)        // → "999"
 * formatCompactNumber(1000)       // → "1.0k"
 * formatCompactNumber(1500)       // → "1.5k"
 * formatCompactNumber(1000000)    // → "1.0M"
 * formatCompactNumber(2500000)    // → "2.5M"
 * formatCompactNumber(1000000000) // → "1.0B"
 * ```
 */
export function formatCompactNumber(num: number): string {
  if (num < 1000) {
    return num.toString();
  } else if (num < 1000000) {
    return `${(num / 1000).toFixed(1)}k`;
  } else if (num < 1000000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  } else {
    return `${(num / 1000000000).toFixed(1)}B`;
  }
}

/**
 * Formats token counts in compact form.
 *
 * Similar to {@link formatCompactNumber} but specifically for token counts.
 * Does not format billions as token counts rarely reach that magnitude.
 *
 * Ranges:
 * - < 1,000: As-is (no suffix)
 * - 1,000 - 999,999: Thousands with 'k' suffix
 * - >= 1,000,000: Millions with 'M' suffix
 *
 * @param tokens - The number of tokens to format
 * @returns Compact formatted string with suffix
 *
 * @example
 * ```typescript
 * formatTokens(256)     // → "256"
 * formatTokens(1000)    // → "1.0k"
 * formatTokens(1500)    // → "1.5k"
 * formatTokens(1200000) // → "1.2M"
 * ```
 *
 * @see {@link formatContextWindow} for context window formatting
 */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) {
    return tokens.toString();
  } else if (tokens < 1000000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  } else {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
}

/**
 * Calculates and formats percentage values.
 *
 * Computes the percentage of value relative to total and formats it with
 * one decimal place. Handles edge case of zero total by returning "0.0%"
 * instead of dividing by zero.
 *
 * @param value - The value to calculate percentage for
 * @param total - The total value (denominator)
 * @returns Percentage string with one decimal place
 *
 * @example
 * ```typescript
 * formatPercentage(75, 100)   // → "75.0%"
 * formatPercentage(50, 200)   // → "25.0%"
 * formatPercentage(755, 1000) // → "75.5%"
 * formatPercentage(0, 100)    // → "0.0%"
 * formatPercentage(100, 100)  // → "100.0%"
 * formatPercentage(50, 0)     // → "0.0%" (avoids division by zero)
 * ```
 */
export function formatPercentage(value: number, total: number): string {
  if (total === 0) {
    return '0.0%';
  }

  const percentage = (value / total) * 100;
  return `${percentage.toFixed(1)}%`;
}

/**
 * Formats context window sizes for model listings.
 *
 * Similar to {@link formatTokens} but specifically for context window sizes.
 * Uses integer division (no decimal places) for cleaner display.
 *
 * Ranges:
 * - < 1,000: As-is (no suffix)
 * - 1,000 - 999,999: Thousands with 'K' suffix (no decimals)
 * - >= 1,000,000: Millions with 'M' suffix (no decimals)
 *
 * @param tokens - The number of tokens in the context window
 * @returns Formatted string with K or M suffix
 *
 * @example
 * ```typescript
 * formatContextWindow(999)      // → "999"
 * formatContextWindow(8000)     // → "8K"
 * formatContextWindow(128000)   // → "128K"
 * formatContextWindow(200000)   // → "200K"
 * formatContextWindow(1000000)  // → "1M"
 * formatContextWindow(2000000)  // → "2M"
 * ```
 *
 * @see {@link formatTokens} for general token formatting
 */
export function formatContextWindow(tokens: number): string {
  if (tokens < 1000) {
    return tokens.toString();
  } else if (tokens < 1000000) {
    return `${Math.floor(tokens / 1000)}K`;
  } else {
    return `${Math.floor(tokens / 1000000)}M`;
  }
}

/**
 * Formats prices in USD currency with 2 decimal places.
 *
 * Formats monetary values with a dollar sign and exactly 2 decimal places.
 * Primarily used for displaying model pricing (cost per 1M tokens).
 *
 * @param pricePerMillion - The price value to format (typically per 1M tokens)
 * @returns Formatted price string with $ prefix and 2 decimals
 *
 * @example
 * ```typescript
 * formatPrice(0)       // → "$0.00"
 * formatPrice(0.074)   // → "$0.07"
 * formatPrice(0.076)   // → "$0.08"
 * formatPrice(3.5)     // → "$3.50"
 * formatPrice(15.0)    // → "$15.00"
 * formatPrice(1000.5)  // → "$1000.50"
 * ```
 *
 * @remarks
 * Uses banker's rounding (round half to even) as implemented by toFixed().
 */
export function formatPrice(pricePerMillion: number): string {
  return `$${pricePerMillion.toFixed(2)}`;
}

/**
 * Formats duration in milliseconds into human-readable format.
 *
 * Converts millisecond durations into a compact format showing hours, minutes,
 * and seconds as appropriate. Omits zero values for cleaner display.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 *
 * @example
 * ```typescript
 * formatDuration(1000)      // → "1s"
 * formatDuration(60000)     // → "1m"
 * formatDuration(61000)     // → "1m 1s"
 * formatDuration(3661000)   // → "1h 1m 1s"
 * formatDuration(7200000)   // → "2h"
 * formatDuration(3723000)   // → "1h 2m 3s"
 * ```
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  const remainingMinutes = minutes % 60;
  if (remainingMinutes > 0) {
    parts.push(`${remainingMinutes}m`);
  }

  const remainingSeconds = seconds % 60;
  if (remainingSeconds > 0 || parts.length === 0) {
    parts.push(`${remainingSeconds}s`);
  }

  return parts.join(' ');
}
