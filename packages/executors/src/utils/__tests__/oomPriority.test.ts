/**
 * R156 HB-OOM-CHILD-PRIORITY — the Bash child raises its own oom_score_adj so the OOM killer takes it
 * before the orchestrator.
 */
import { describe, it, expect } from 'vitest';
import { resolveBashOomPriority, bashOomPriorityPrelude } from '../oomPriority.js';

describe('resolveBashOomPriority', () => {
  it('defaults on; false/0/off disable', () => {
    expect(resolveBashOomPriority({})).toBe(true);
    expect(resolveBashOomPriority({ CORTEX_BASH_OOM_PRIORITY: 'true' })).toBe(true);
    for (const v of ['false', '0', 'off', 'FALSE']) expect(resolveBashOomPriority({ CORTEX_BASH_OOM_PRIORITY: v })).toBe(false);
  });
});

describe('bashOomPriorityPrelude', () => {
  it('emits the best-effort oom_score_adj write on linux', () => {
    const p = bashOomPriorityPrelude({}, 'linux');
    expect(p).toContain('/proc/self/oom_score_adj');
    expect(p).toContain('1000');
    expect(p.endsWith('; ')).toBe(true);
    expect(p).toContain('2>/dev/null');
  });
  it('is empty when disabled or off-linux (byte-identical command)', () => {
    expect(bashOomPriorityPrelude({ CORTEX_BASH_OOM_PRIORITY: 'false' }, 'linux')).toBe('');
    expect(bashOomPriorityPrelude({}, 'darwin')).toBe('');
    expect(bashOomPriorityPrelude({}, 'win32')).toBe('');
  });
});
