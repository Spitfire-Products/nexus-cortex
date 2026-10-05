import { describe, it, expect } from 'vitest';
import { resolveHttpTimeoutMs } from '../APIClient';

describe('resolveHttpTimeoutMs (2026-10-05 — the 384K cap needs more than the SDK\'s 600 s)', () => {
  it('keeps the SDK default when the cap is small or unknown', () => {
    expect(resolveHttpTimeoutMs(undefined, {} as any)).toBe(600_000);
    expect(resolveHttpTimeoutMs(4096, {} as any)).toBe(600_000);
    expect(resolveHttpTimeoutMs(30_000, {} as any)).toBe(600_000); // 30k * 20ms = 600 s exactly
  });
  it('scales with the cap at 50 tok/s', () => {
    expect(resolveHttpTimeoutMs(65_536, {} as any)).toBe(1_310_720);
    expect(resolveHttpTimeoutMs(393_216, {} as any)).toBe(7_864_320);
  });
  it('the env lever wins', () => {
    expect(resolveHttpTimeoutMs(393_216, { CORTEX_HTTP_TIMEOUT_MS: '900000' } as any)).toBe(900_000);
    expect(resolveHttpTimeoutMs(393_216, { CORTEX_HTTP_TIMEOUT_MS: 'junk' } as any)).toBe(7_864_320);
  });
});
