import { describe, it, expect } from 'vitest';
import { truncateDocForInjection, resolveDocMaxBytes } from '../docTruncation.js';

describe('truncateDocForInjection', () => {
  const big = 'x'.repeat(5000);

  it('returns content unchanged when maxBytes is 0/undefined', () => {
    expect(truncateDocForInjection(big, { maxBytes: 0 })).toBe(big);
    expect(truncateDocForInjection(big)).toBe(big);
  });

  it('returns content unchanged when content fits inside cap', () => {
    const small = 'hello';
    expect(truncateDocForInjection(small, { maxBytes: 1000 })).toBe(small);
  });

  it('truncates content longer than cap and appends marker with byte counts', () => {
    const out = truncateDocForInjection(big, { maxBytes: 1000, sourcePath: '/path/to/CLAUDE.md', label: 'CLAUDE.md' });
    expect(out.length).toBeLessThan(big.length);
    expect(out).toContain('CLAUDE.md truncated');
    expect(out).toContain('/path/to/CLAUDE.md');
    expect(out).toContain('4,000 of 5,000 bytes omitted');
    expect(out).toContain('use the Read tool');
  });

  it('keeps the head of the content intact when truncating', () => {
    const content = 'HEAD_MARKER' + 'y'.repeat(10000);
    const out = truncateDocForInjection(content, { maxBytes: 100, label: 'doc' });
    expect(out.startsWith('HEAD_MARKER')).toBe(true);
  });
});

describe('resolveDocMaxBytes', () => {
  it('returns 0 (no cap) when env var is missing or empty', () => {
    expect(resolveDocMaxBytes(undefined)).toBe(0);
    expect(resolveDocMaxBytes('')).toBe(0);
  });

  it('returns parsed integer when env var is positive number', () => {
    expect(resolveDocMaxBytes('8000')).toBe(8000);
    expect(resolveDocMaxBytes('1')).toBe(1);
  });

  it('returns 0 for negative, non-numeric, or garbage env values', () => {
    expect(resolveDocMaxBytes('-100')).toBe(0);
    expect(resolveDocMaxBytes('abc')).toBe(0);
    expect(resolveDocMaxBytes('NaN')).toBe(0);
  });
});
