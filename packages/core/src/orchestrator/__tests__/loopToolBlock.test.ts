import { describe, it, expect } from 'vitest';
import { decideLoopBlock, isLoopBlockTrigger, LOOP_BLOCK_MAX } from '../loopToolBlock.js';

describe('loopToolBlock', () => {
  describe('isLoopBlockTrigger', () => {
    it('fires on diversify and break, not on remind/none', () => {
      expect(isLoopBlockTrigger('diversify')).toBe(true);
      expect(isLoopBlockTrigger('break')).toBe(true);
      expect(isLoopBlockTrigger('remind')).toBe(false);
      expect(isLoopBlockTrigger('none')).toBe(false);
      expect(isLoopBlockTrigger(undefined)).toBe(false);
    });
  });

  describe('decideLoopBlock — keyed redirect', () => {
    it('Bash-loop → drop Bash, steer to Read/Write/Edit', () => {
      const d = decideLoopBlock('Bash', 0);
      expect(d.action).toBe('block');
      expect(d.tool).toBe('Bash');
      expect(d.redirectTools).toEqual(['Read', 'Write', 'Edit']);
      expect(d.message).toContain('DISABLED');
      expect(d.message).toContain('Read, Write, Edit');
      expect(d.message).toContain('#1');
    });

    it('Edit-loop → drop Edit but KEEP Bash (the verify channel)', () => {
      const d = decideLoopBlock('Edit', 0);
      expect(d.action).toBe('block');
      expect(d.redirectTools).toContain('Bash'); // never remove the only verify path
      expect(d.redirectTools).toContain('Read');
      expect(d.redirectTools).not.toContain('Edit');
    });

    it('unknown tool → default redirect (Read + Bash)', () => {
      const d = decideLoopBlock('WebFetch', 0);
      expect(d.action).toBe('block');
      expect(d.redirectTools).toEqual(['Read', 'Bash']);
    });

    it('escalates to mentor after LOOP_BLOCK_MAX blocks', () => {
      expect(decideLoopBlock('Bash', LOOP_BLOCK_MAX - 1).action).toBe('block');
      expect(decideLoopBlock('Bash', LOOP_BLOCK_MAX).action).toBe('escalate');
      expect(decideLoopBlock('Bash', LOOP_BLOCK_MAX + 1).action).toBe('escalate');
    });

    it('block message counts the intervention number', () => {
      expect(decideLoopBlock('Bash', 0).message).toContain('#1');
      expect(decideLoopBlock('Bash', 1).message).toContain('#2');
    });
  });
});

// R135 HB-POLL-LOOP (2026-09-13): the hard block never arms on a poll outcome, and never removes the
// ONLY execution tool in the current tool set (the R135/R136 damage mode: "Bash is disabled").
import { describe as d135, it as it135, expect as ex135 } from 'vitest';
import { shouldArmLoopBlock, hasAlternativeExecutor } from '../loopToolBlock.js';

d135('loopToolBlock R135 guards', () => {
  const sim = { action: 'diversify', family: 'neardup', trigger: 'similarity' };

  it135('shouldArmLoopBlock refuses a poll outcome even when a lens fired (any status)', () => {
    ex135(shouldArmLoopBlock(sim, { status: 'ok', poll: { isPoll: true } })).toBe(false);
    ex135(shouldArmLoopBlock({ action: 'break' }, { status: 'failed', poll: { isPoll: true } })).toBe(false);
    ex135(shouldArmLoopBlock(sim, { status: 'ok', poll: { isPoll: false } })).toBe(true);
    ex135(shouldArmLoopBlock(sim, { status: 'failed' })).toBe(true);
    ex135(shouldArmLoopBlock(sim)).toBe(true);
    ex135(shouldArmLoopBlock({ action: 'remind' })).toBe(false);
  });

  it135('hasAlternativeExecutor: blocking Bash needs Task or Skill in the tool set', () => {
    ex135(hasAlternativeExecutor('Bash', ['Bash', 'Read', 'Write', 'Edit'])).toBe(false);
    ex135(hasAlternativeExecutor('Bash', ['Bash', 'Read', 'Task'])).toBe(true);
    ex135(hasAlternativeExecutor('Bash', ['Bash', 'Skill'])).toBe(true);
    ex135(hasAlternativeExecutor('Bash', [])).toBe(false);
  });

  it135('hasAlternativeExecutor: a non-executor block (Edit) is never guarded', () => {
    ex135(hasAlternativeExecutor('Edit', ['Bash', 'Edit'])).toBe(true);
    ex135(hasAlternativeExecutor('WebFetch', ['WebFetch'])).toBe(true);
  });
});
