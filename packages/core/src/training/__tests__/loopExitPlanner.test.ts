import { describe, it, expect } from 'vitest';
import {
  resolveLoopExitConfig,
  buildLoopExitPrompt,
  parseLoopExitVerdict,
  LOOP_EXIT_SYSTEM,
} from '../loopExitPlanner.js';

describe('loopExitPlanner', () => {
  describe('resolveLoopExitConfig', () => {
    it('defaults to bounded pro-max (effort max, 4000 budget, 90s)', () => {
      const cfg = resolveLoopExitConfig({} as NodeJS.ProcessEnv);
      expect(cfg.effort).toBe('max');
      expect(cfg.outputBudgetTokens).toBe(4000);
      expect(cfg.timeoutMs).toBe(90000);
    });
    it('honors env overrides', () => {
      const cfg = resolveLoopExitConfig({
        CORTEX_LOOP_TOOL_BLOCK_EFFORT: 'high',
        CORTEX_LOOP_TOOL_BLOCK_BUDGET_TOKENS: '2000',
        CORTEX_LOOP_TOOL_BLOCK_TIMEOUT_MS: '45000',
      } as unknown as NodeJS.ProcessEnv);
      expect(cfg.effort).toBe('high');
      expect(cfg.outputBudgetTokens).toBe(2000);
      expect(cfg.timeoutMs).toBe(45000);
    });
    it('ignores invalid numeric overrides (falls back to defaults)', () => {
      const cfg = resolveLoopExitConfig({
        CORTEX_LOOP_TOOL_BLOCK_BUDGET_TOKENS: 'abc',
        CORTEX_LOOP_TOOL_BLOCK_TIMEOUT_MS: '-5',
      } as unknown as NodeJS.ProcessEnv);
      expect(cfg.outputBudgetTokens).toBe(4000);
      expect(cfg.timeoutMs).toBe(90000);
    });
  });

  describe('parseLoopExitVerdict', () => {
    it('reads REPLAN from the first line', () => {
      expect(parseLoopExitVerdict('VERDICT: REPLAN\n1. do X')).toBe('REPLAN');
    });
    it('reads RETIRE case-insensitively with leading space', () => {
      expect(parseLoopExitVerdict('  verdict: retire\nunclosable')).toBe('RETIRE');
    });
    it('returns UNKNOWN on unparseable / empty text (fail-open)', () => {
      expect(parseLoopExitVerdict('no verdict here')).toBe('UNKNOWN');
      expect(parseLoopExitVerdict('')).toBe('UNKNOWN');
    });
  });

  describe('buildLoopExitPrompt', () => {
    it('includes task, looping tool, env report and recent attempts', () => {
      const p = buildLoopExitPrompt({
        task: 'make the tests pass',
        envReport: 'python3 present',
        loopingTool: 'Bash',
        recentAttempts: 'call: grep FINDME\n → result: (empty)',
      });
      expect(p).toContain('make the tests pass');
      expect(p).toContain('LOOPING TOOL (blocked twice): Bash');
      expect(p).toContain('python3 present');
      expect(p).toContain('grep FINDME');
    });
    it('omits optional sections cleanly when absent', () => {
      const p = buildLoopExitPrompt({ task: 'T', loopingTool: 'Edit' });
      expect(p).toContain('LOOPING TOOL (blocked twice): Edit');
      expect(p).not.toContain('ENVIRONMENT REPORT');
      expect(p).not.toContain('RECENT ATTEMPTS');
    });
  });

  it('LOOP_EXIT_SYSTEM carries the {{TOOL}} placeholder and the REPLAN|RETIRE contract', () => {
    expect(LOOP_EXIT_SYSTEM).toContain('{{TOOL}}');
    expect(LOOP_EXIT_SYSTEM).toContain('VERDICT: REPLAN');
    expect(LOOP_EXIT_SYSTEM).toContain('VERDICT: RETIRE');
  });
});
