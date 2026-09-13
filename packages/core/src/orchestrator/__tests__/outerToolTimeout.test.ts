import { describe, it, expect } from 'vitest';
import { resolveOuterToolDeadlineMs, resolveOuterToolTimeoutFloorMs } from '../outerToolTimeout.js';

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

  // R133 HB-SUBAGENT-TIMEOUT: a Task batch was aborted at ~150s, BELOW the 300s (now deadline-derived)
  // sub-agent timeout. A per-block resolver lets Task blocks contribute their resolved timeout.
  describe('Task blocks contribute their resolved sub-agent timeout (R133)', () => {
    it('without a resolver a Task block is ignored (legacy behaviour)', () => {
      expect(resolveOuterToolDeadlineMs([{ name: 'Task', input: { timeout_ms: 900_000 } }], T, G)).toBe(150_000);
    });
    it('a Task block raises the outer deadline to its resolved timeout + grace', () => {
      const blocks = [{ name: 'Task', input: { subagent_type: 'x' } }, { name: 'Read', input: {} }];
      expect(resolveOuterToolDeadlineMs(blocks, T, G, (b) => (b.name === 'Task' ? 3_210_000 : undefined))).toBe(3_240_000);
    });
    it('takes the MAX across Bash requests and Task resolutions; Task is NOT clamped to the shell ceiling', () => {
      const blocks = [
        { name: 'Bash', input: { timeout: 400_000 } },
        { name: 'Task', input: {} },
        { name: 'Task', input: {} },
      ];
      const ms = [0, 700_000, 5_000_000];
      expect(resolveOuterToolDeadlineMs(blocks, T, G, (_b, i) => (i === 0 ? undefined : ms[i]))).toBe(5_030_000);
      expect(resolveOuterToolDeadlineMs(blocks, T, G, (_b, i) => (i === 0 ? undefined : 200_000))).toBe(430_000);
    });
    it('ignores garbage resolver values', () => {
      expect(resolveOuterToolDeadlineMs([{ name: 'Task', input: {} }], T, G, () => NaN)).toBe(150_000);
      expect(resolveOuterToolDeadlineMs([{ name: 'Task', input: {} }], T, G, () => -1)).toBe(150_000);
    });
  });

  // CORTEX_OUTER_TOOL_TIMEOUT_MS: a FLOOR for the outer batch deadline — non-Bash tools with no limit of
  // their own (CreateArtifactTool persistent launches, ctr-optimization) were killed at the static 150s.
  describe('CORTEX_OUTER_TOOL_TIMEOUT_MS floor', () => {
    it('resolveOuterToolTimeoutFloorMs: unset / 0 / junk / negative → 0 (no floor)', () => {
      expect(resolveOuterToolTimeoutFloorMs({})).toBe(0);
      expect(resolveOuterToolTimeoutFloorMs({ CORTEX_OUTER_TOOL_TIMEOUT_MS: '' })).toBe(0);
      expect(resolveOuterToolTimeoutFloorMs({ CORTEX_OUTER_TOOL_TIMEOUT_MS: '0' })).toBe(0);
      expect(resolveOuterToolTimeoutFloorMs({ CORTEX_OUTER_TOOL_TIMEOUT_MS: 'junk' })).toBe(0);
      expect(resolveOuterToolTimeoutFloorMs({ CORTEX_OUTER_TOOL_TIMEOUT_MS: '-5' })).toBe(0);
      expect(resolveOuterToolTimeoutFloorMs({ CORTEX_OUTER_TOOL_TIMEOUT_MS: ' 600000 ' })).toBe(600_000);
      expect(resolveOuterToolTimeoutFloorMs({ CORTEX_OUTER_TOOL_TIMEOUT_MS: '600000.9' })).toBe(600_000);
    });
    it('floor unset (undefined / 0) → deadline unchanged', () => {
      expect(resolveOuterToolDeadlineMs([{ name: 'Read', input: {} }], T, G, undefined, undefined)).toBe(150_000);
      expect(resolveOuterToolDeadlineMs([{ name: 'Read', input: {} }], T, G, undefined, 0)).toBe(150_000);
    });
    it('floor 600000 with a plain non-Bash block → deadline = floor + grace', () => {
      expect(resolveOuterToolDeadlineMs([{ name: 'CreateArtifact', input: {} }], T, G, undefined, 600_000)).toBe(630_000);
    });
    it('floor below the computed value → computed wins', () => {
      expect(resolveOuterToolDeadlineMs([{ name: 'Bash', input: { timeout: 400_000 } }], T, G, undefined, 200_000)).toBe(430_000);
      expect(resolveOuterToolDeadlineMs([{ name: 'Task', input: {} }], T, G, () => 3_210_000, 200_000)).toBe(3_240_000);
      expect(resolveOuterToolDeadlineMs([{ name: 'Read', input: {} }], T, G, undefined, 100_000)).toBe(150_000);
    });
    it('junk / negative floor → no floor', () => {
      expect(resolveOuterToolDeadlineMs([{ name: 'Read', input: {} }], T, G, undefined, NaN)).toBe(150_000);
      expect(resolveOuterToolDeadlineMs([{ name: 'Read', input: {} }], T, G, undefined, -1)).toBe(150_000);
    });
  });
});
