import { describe, it, expect } from 'vitest';
import { resolveMaxStoreBytes, DEFAULT_MAX_STORE_BYTES } from '../DecisionStore.js';

describe('resolveMaxStoreBytes — CORTEX_DECISIONS_MAX_BYTES env override', () => {
  it('falls back to the default when unset', () => {
    expect(resolveMaxStoreBytes({})).toBe(DEFAULT_MAX_STORE_BYTES);
  });

  it('uses a valid positive integer', () => {
    expect(resolveMaxStoreBytes({ CORTEX_DECISIONS_MAX_BYTES: '1048576' })).toBe(1048576);
  });

  it('trims surrounding whitespace', () => {
    expect(resolveMaxStoreBytes({ CORTEX_DECISIONS_MAX_BYTES: '  4096  ' })).toBe(4096);
  });

  it('rejects zero → default', () => {
    expect(resolveMaxStoreBytes({ CORTEX_DECISIONS_MAX_BYTES: '0' })).toBe(DEFAULT_MAX_STORE_BYTES);
  });

  it('rejects negative → default', () => {
    expect(resolveMaxStoreBytes({ CORTEX_DECISIONS_MAX_BYTES: '-512' })).toBe(DEFAULT_MAX_STORE_BYTES);
  });

  it('rejects non-numeric → default', () => {
    expect(resolveMaxStoreBytes({ CORTEX_DECISIONS_MAX_BYTES: 'abc' })).toBe(DEFAULT_MAX_STORE_BYTES);
  });

  it('rejects a float (must be an integer byte count) → default', () => {
    expect(resolveMaxStoreBytes({ CORTEX_DECISIONS_MAX_BYTES: '1.5' })).toBe(DEFAULT_MAX_STORE_BYTES);
  });
});
