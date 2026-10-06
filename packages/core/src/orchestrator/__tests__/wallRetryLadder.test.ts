import { describe, it, expect } from 'vitest';
import { resolveWallRetryLadder, ladderCapFor, shouldForceAction } from '../wallRetryLadder';

const exh = { kind: 'truncated', hadReasoning: true, hadToolUse: false } as any;
const forbid = { kind: 'demand_final_answer', hadReasoning: false, hadToolUse: false } as any;

describe('HB-WALL-RETRY-LADDER (dark)', () => {
  it('off by default: no rungs, caps pass through, never forces', () => {
    const cfg = resolveWallRetryLadder({} as any);
    expect(cfg.enabled).toBe(false);
    expect(ladderCapFor(cfg, 1, 393216)).toBe(393216);
    expect(shouldForceAction(cfg, 5, exh)).toBe(false);
  });
  it('parses the ladder; the last rung repeats; never raises above the request cap', () => {
    const cfg = resolveWallRetryLadder({ CORTEX_WALL_RETRY_LADDER: '65536,16384' } as any);
    expect(cfg.enabled).toBe(true);
    expect(ladderCapFor(cfg, 1, 393216)).toBe(65536);
    expect(ladderCapFor(cfg, 2, 393216)).toBe(16384);
    expect(ladderCapFor(cfg, 7, 393216)).toBe(16384);
    expect(ladderCapFor(cfg, 1, 32000)).toBe(32000);
    expect(ladderCapFor(cfg, 1, undefined)).toBe(65536);
  });
  it('forces an action from wall FORCE_ACTION_AT on, only for exhaustion kinds', () => {
    const cfg = resolveWallRetryLadder({ CORTEX_WALL_RETRY_LADDER: '65536,16384' } as any);
    expect(cfg.forceActionAt).toBe(2);
    expect(shouldForceAction(cfg, 1, exh)).toBe(false);
    expect(shouldForceAction(cfg, 2, exh)).toBe(true);
    expect(shouldForceAction(cfg, 2, forbid)).toBe(false);
    expect(shouldForceAction(resolveWallRetryLadder({ CORTEX_WALL_RETRY_LADDER: '65536', CORTEX_WALL_FORCE_ACTION_AT: '0' } as any), 9, exh)).toBe(false);
    expect(shouldForceAction(resolveWallRetryLadder({ CORTEX_WALL_RETRY_LADDER: '65536', CORTEX_WALL_FORCE_ACTION_AT: '1' } as any), 1, exh)).toBe(true);
  });
  it('ignores junk rungs', () => {
    const cfg = resolveWallRetryLadder({ CORTEX_WALL_RETRY_LADDER: 'abc, 12, 20000' } as any);
    expect(cfg.rungs).toEqual([20000]);
  });
});
