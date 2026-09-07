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
