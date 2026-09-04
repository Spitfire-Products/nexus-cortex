import { describe, it, expect } from 'vitest';
import { resolveOuterToolDeadlineMs } from '../outerToolTimeout.js';

const T = 120_000; // TOOL_TIMEOUT_MS
const G = 30_000; // OUTER_TIMEOUT_GRACE_MS

describe('resolveOuterToolDeadlineMs (D-A)', () => {
  it('no Bash / no requested timeout → static TOOL_TIMEOUT_MS + grace (legacy behaviour)', () => {
    expect(resolveOuterToolDeadlineMs([], T, G)).toBe(150_000);
    expect(resolveOuterToolDeadlineMs([{ name: 'Read', input: {} }], T, G)).toBe(150_000);
    expect(resolveOuterToolDeadlineMs([{ name: 'Bash', input: { command: 'ls' } }], T, G)).toBe(150_000);
  });

  it('a Bash requesting MORE than the default → outer deadline rises above it (the D-A fix)', () => {
    // was killed at 150s; now the outer cap is 250000 + 30000
    expect(resolveOuterToolDeadlineMs([{ name: 'Bash', input: { command: 'sleep 200', timeout: 250_000 } }], T, G)).toBe(280_000);
  });

  it('a Bash requesting LESS than the default → still floored at TOOL_TIMEOUT_MS + grace', () => {
    expect(resolveOuterToolDeadlineMs([{ name: 'Bash', input: { timeout: 5_000 } }], T, G)).toBe(150_000);
  });

  it('takes the MAX requested across a batch of Bash calls', () => {
    expect(resolveOuterToolDeadlineMs([
      { name: 'Bash', input: { timeout: 200_000 } },
      { name: 'Bash', input: { timeout: 400_000 } },
      { name: 'Edit', input: { timeout: 999_999_999 } }, // non-Bash timeout ignored
    ], T, G)).toBe(430_000);
  });

  it('clamps the requested timeout to ShellTool.MAX_TIMEOUT_MS (600000) before adding grace', () => {
    expect(resolveOuterToolDeadlineMs([{ name: 'Bash', input: { timeout: 5_000_000 } }], T, G)).toBe(630_000);
  });

  it('ignores garbage timeout values', () => {
    expect(resolveOuterToolDeadlineMs([{ name: 'Bash', input: { timeout: 'nope' } }], T, G)).toBe(150_000);
    expect(resolveOuterToolDeadlineMs([{ name: 'Bash', input: { timeout: -5 } }], T, G)).toBe(150_000);
  });
});
