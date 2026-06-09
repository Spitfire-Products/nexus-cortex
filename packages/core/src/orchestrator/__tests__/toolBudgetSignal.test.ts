/**
 * R29b: tool-budget brake for runaway exploration.
 *
 * The 6-surface benchmark caught deepseek-chat doing 46 successful local
 * tool calls (Read/Grep/Glob — zero web) over 392s with no convergence.
 * The old getBudgetSignal was ratio-of-maxIterations only, fired late
 * (25/40 of 50), and emitted soft bracketed hints a weak model skims past.
 * The brake must escalate on ABSOLUTE count with firm, imperative language.
 */
import { describe, it, expect } from 'vitest';
import { computeToolBudgetSignal, isToolProgressStalled } from '../toolBudgetSignal.js';

const mk = (name: string, inputHash: string) => ({ name, inputHash });

describe('computeToolBudgetSignal', () => {
  const soft = 15;

  it('no signal well under the soft budget', () => {
    expect(computeToolBudgetSignal(3, soft)).toBeNull();
    expect(computeToolBudgetSignal(14, soft)).toBeNull();
  });

  it('firm directive at the soft budget', () => {
    const s = computeToolBudgetSignal(15, soft);
    expect(s).not.toBeNull();
    expect(s!).toMatch(/final answer now|provide your (final )?answer/i);
    expect(s!).toContain('15');
  });

  it('firm STOP at 1.5x ONLY when progress is stalled (cycling)', () => {
    const s = computeToolBudgetSignal(Math.ceil(soft * 1.5), soft, true);
    expect(s).not.toBeNull();
    expect(s!).toMatch(/STOP/);
    expect(s!).toMatch(/do not call (any )?more tools/i);
  });

  it('at 1.5x while still progressing, nudges to converge but does NOT command STOP', () => {
    const s = computeToolBudgetSignal(Math.ceil(soft * 1.5), soft, false);
    expect(s).not.toBeNull();
    // No hard "do not call any more tools" — a still-advancing model may continue.
    expect(s!).not.toMatch(/do not call (any )?more tools/i);
    expect(s!).toMatch(/synthesize|converge|finish|answering now/i);
  });

  it('escalates: 1.5x message is firmer/distinct from soft message', () => {
    expect(computeToolBudgetSignal(15, soft)).not.toBe(
      computeToolBudgetSignal(23, soft, true),
    );
  });

  it('is imperative, not a skippable bracketed hint', () => {
    // The old format was "[Tool budget: ...]" — weak models ignored it.
    const s = computeToolBudgetSignal(20, soft)!;
    expect(s.startsWith('[Tool budget:')).toBe(false);
    expect(s).toMatch(/<system-reminder>/);
  });

  it('tolerates a zero/invalid soft budget without throwing', () => {
    expect(computeToolBudgetSignal(10, 0)).toBeNull();
    expect(computeToolBudgetSignal(10, -1)).toBeNull();
  });
});

describe('isToolProgressStalled (progress gate for the hard cap)', () => {
  it('returns false before there are enough calls to judge', () => {
    expect(isToolProgressStalled([mk('Grep', 'a'), mk('Read', 'b')])).toBe(false);
  });

  it('returns false for diverse, advancing work (all distinct) even at high volume', () => {
    // A genuine long-running task: 30 distinct calls must NOT be force-stopped.
    const diverse = Array.from({ length: 30 }, (_, i) => mk('Grep', 'q' + i));
    expect(isToolProgressStalled(diverse)).toBe(false);
  });

  it('returns false for mixed productive work (varied tools, distinct inputs)', () => {
    const tools = ['Grep', 'Read', 'Edit', 'Bash', 'Glob'];
    const productive = Array.from({ length: 35 }, (_, i) => mk(tools[i % 5]!, 'x' + i));
    expect(isToolProgressStalled(productive)).toBe(false);
  });

  it('returns true when the recent window mostly re-issues earlier signatures (cycling)', () => {
    const cycling = [
      ...Array.from({ length: 12 }, (_, i) => mk('Grep', 'q' + i)),
      // recent 8 all repeat q1/q2 — clear cycling
      mk('Grep', 'q1'), mk('Grep', 'q2'), mk('Grep', 'q1'), mk('Grep', 'q2'),
      mk('Grep', 'q1'), mk('Grep', 'q2'), mk('Grep', 'q1'), mk('Grep', 'q2'),
    ];
    expect(isToolProgressStalled(cycling)).toBe(true);
  });

  it('distinguishes same-tool-different-input (progress) from same-tool-same-input (stall)', () => {
    const advancing = Array.from({ length: 16 }, (_, i) => mk('Read', 'file' + i));
    expect(isToolProgressStalled(advancing)).toBe(false);
    const stuck = Array.from({ length: 16 }, () => mk('Read', 'sameFile'));
    expect(isToolProgressStalled(stuck)).toBe(true);
  });
});
