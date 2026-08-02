/**
 * Tail-repetition doom-loop detector (grok-build port). Pins: no-false-positive
 * on healthy reasoning, line-cycle detection, char-cycle detection, the
 * minRepeats threshold, and short-fragment tolerance.
 */

import { describe, it, expect } from 'vitest';
import { detectTailRepetition } from '../tailRepetitionDetector.js';

describe('detectTailRepetition', () => {
  it('does NOT flag healthy varied reasoning', () => {
    const text = [
      'First I need to read the config file to understand the current setup.',
      'The port is 4000 and the mode is stateless, so requests are isolated.',
      'Next I should check whether the tool array includes the search tool.',
      'It does, so I can proceed to call it with the right category filter.',
      'Now let me assemble the final answer from what the tools returned.',
    ].join('\n');
    expect(detectTailRepetition(text).looping).toBe(false);
  });

  it('does NOT flag a short prompt', () => {
    expect(detectTailRepetition('Let me think about this carefully.').looping).toBe(false);
    expect(detectTailRepetition('').looping).toBe(false);
  });

  it('flags a repeated identical reasoning LINE (the common grok loop shape)', () => {
    const text = 'Some setup reasoning first.\n' +
      Array(6).fill('I should verify the workspace state before proceeding.').join('\n');
    const r = detectTailRepetition(text);
    expect(r.looping).toBe(true);
    expect(r.trigger).toMatch(/^tail_repetition:\d+@thinking$/);
    expect(r.repeats).toBeGreaterThanOrEqual(4);
  });

  it('flags a repeated newline-free phrase (char-cycle)', () => {
    const text = 'thinking... ' + 'the answer is probably yes but let me reconsider once more. '.repeat(8);
    expect(detectTailRepetition(text).looping).toBe(true);
  });

  it('respects minRepeats — 3 repeats of a line is not yet a loop at default 4', () => {
    const text = 'setup.\n' + Array(3).fill('checking the same condition again here now.').join('\n');
    expect(detectTailRepetition(text).looping).toBe(false);
  });

  it('detects a loop even with trailing healthy-looking content before it', () => {
    const good = 'I analyzed the file and found three distinct sections to review. ';
    const loop = 'I cannot make progress on this step. '.repeat(6);
    expect(detectTailRepetition(good + loop).looping).toBe(true);
  });

  it('does not flag a short coincidental fragment repeat', () => {
    // "the " repeats but is below minCycleLen (24) — must not trip
    const text = 'the cat sat on the mat and the dog ran to the park in the rain today.';
    expect(detectTailRepetition(text).looping).toBe(false);
  });

  it('tolerates cosmetic whitespace differences in the repeating unit', () => {
    const unit = 'I need to re-check   the same value again.';
    const text = 'ok.\n' + Array(5).fill(unit).join('\n');
    expect(detectTailRepetition(text).looping).toBe(true);
  });

  it('honors a custom minRepeats threshold', () => {
    const text = 'x.\n' + Array(3).fill('repeating this exact line over and over.').join('\n');
    expect(detectTailRepetition(text, { minRepeats: 3 }).looping).toBe(true);
    expect(detectTailRepetition(text, { minRepeats: 5 }).looping).toBe(false);
  });
});
