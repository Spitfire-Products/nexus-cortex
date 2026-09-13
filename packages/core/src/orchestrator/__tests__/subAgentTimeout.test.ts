import { describe, it, expect } from 'vitest';
import { resolveSubAgentTimeoutMs, DEFAULT_SUBAGENT_TIMEOUT_MS, MIN_SUBAGENT_TIMEOUT_MS } from '../subAgentTimeout.js';

describe('resolveSubAgentTimeoutMs (R133 HB-SUBAGENT-TIMEOUT)', () => {
  it('exports the shared library default (behaviour-preserving for the SubAgent* defaults)', () => {
    expect(DEFAULT_SUBAGENT_TIMEOUT_MS).toBe(300_000);
    expect(MIN_SUBAGENT_TIMEOUT_MS).toBe(60_000);
  });

  it('no inputs → 300000 / default', () => {
    expect(resolveSubAgentTimeoutMs({ env: {} })).toEqual({ timeoutMs: 300_000, source: 'default' });
    expect(resolveSubAgentTimeoutMs({ remainingMs: 0, env: {} })).toEqual({ timeoutMs: 300_000, source: 'default' });
    expect(resolveSubAgentTimeoutMs({ remainingMs: -5, requestedMs: NaN, env: {} })).toEqual({ timeoutMs: 300_000, source: 'default' });
  });

  it('env only → CORTEX_SUBAGENT_TIMEOUT_MS when a positive number, else default', () => {
    expect(resolveSubAgentTimeoutMs({ env: { CORTEX_SUBAGENT_TIMEOUT_MS: '900000' } })).toEqual({ timeoutMs: 900_000, source: 'env' });
    expect(resolveSubAgentTimeoutMs({ env: { CORTEX_SUBAGENT_TIMEOUT_MS: '0' } })).toEqual({ timeoutMs: 300_000, source: 'default' });
    expect(resolveSubAgentTimeoutMs({ env: { CORTEX_SUBAGENT_TIMEOUT_MS: 'nope' } })).toEqual({ timeoutMs: 300_000, source: 'default' });
  });

  it('deadline only → 90% of the remaining turn budget minus a 30 s margin (the 8-hour-bench fix)', () => {
    // remaining 1h → 3_600_000 * 0.9 - 30_000
    expect(resolveSubAgentTimeoutMs({ remainingMs: 3_600_000, env: {} })).toEqual({ timeoutMs: 3_210_000, source: 'deadline' });
    // the deadline derivation beats the env default
    expect(resolveSubAgentTimeoutMs({ remainingMs: 3_600_000, env: { CORTEX_SUBAGENT_TIMEOUT_MS: '900000' } })).toEqual({ timeoutMs: 3_210_000, source: 'deadline' });
  });

  it('deadline nearly exhausted → floored at 60 s', () => {
    expect(resolveSubAgentTimeoutMs({ remainingMs: 40_000, env: {} })).toEqual({ timeoutMs: 60_000, source: 'deadline' });
  });

  it('deadline derivation is capped by CORTEX_SUBAGENT_TIMEOUT_MAX_MS when set', () => {
    expect(resolveSubAgentTimeoutMs({ remainingMs: 3_600_000, env: { CORTEX_SUBAGENT_TIMEOUT_MAX_MS: '600000' } })).toEqual({ timeoutMs: 600_000, source: 'deadline' });
    // an unparseable / non-positive cap is ignored
    expect(resolveSubAgentTimeoutMs({ remainingMs: 3_600_000, env: { CORTEX_SUBAGENT_TIMEOUT_MAX_MS: '0' } })).toEqual({ timeoutMs: 3_210_000, source: 'deadline' });
  });

  it('requested within range wins over deadline and env', () => {
    expect(resolveSubAgentTimeoutMs({ requestedMs: 120_000, remainingMs: 3_600_000, env: { CORTEX_SUBAGENT_TIMEOUT_MS: '900000' } }))
      .toEqual({ timeoutMs: 120_000, source: 'requested' });
    expect(resolveSubAgentTimeoutMs({ requestedMs: 120_000, env: {} })).toEqual({ timeoutMs: 120_000, source: 'requested' });
  });

  it('requested above the remaining budget → clamped to remaining minus the margin', () => {
    expect(resolveSubAgentTimeoutMs({ requestedMs: 10_000_000, remainingMs: 600_000, env: {} }))
      .toEqual({ timeoutMs: 570_000, source: 'requested' });
  });

  it('requested below 60 s → raised to 60 s', () => {
    expect(resolveSubAgentTimeoutMs({ requestedMs: 5_000, env: {} })).toEqual({ timeoutMs: 60_000, source: 'requested' });
    expect(resolveSubAgentTimeoutMs({ requestedMs: 5_000, remainingMs: 3_600_000, env: {} })).toEqual({ timeoutMs: 60_000, source: 'requested' });
  });

  it('requested with no deadline is not capped by anything but the floor', () => {
    expect(resolveSubAgentTimeoutMs({ requestedMs: 7_200_000, env: {} })).toEqual({ timeoutMs: 7_200_000, source: 'requested' });
  });
});
