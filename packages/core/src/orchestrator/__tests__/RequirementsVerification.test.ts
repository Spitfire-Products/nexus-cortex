/**
 * EndTurn Stage 4 — requirements attestation (backlog item 1).
 * Unit table: empty reqs on task-shaped turn / malformed row / UNVERIFIED
 * row / mutating-turn-no-checks / clean pass — plus mode + task-shape edges.
 */

import { describe, it, expect } from 'vitest';
import {
  verifyRequirements,
  resolveEndTurnRequirementsMode,
  isTaskShaped,
} from '../requirementsVerification.js';

const cleanRow = {
  requirement: 'compress the file losslessly',
  satisfied_by: 'compress.py implements LZ77 + huffman',
  verified_how: 'python3 verify.py → OK ratio=0.31',
};

describe('resolveEndTurnRequirementsMode', () => {
  it('off by default, on only for exact "true"', () => {
    expect(resolveEndTurnRequirementsMode({} as NodeJS.ProcessEnv)).toBe(false);
    expect(resolveEndTurnRequirementsMode({ CORTEX_ENDTURN_REQUIREMENTS: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    expect(resolveEndTurnRequirementsMode({ CORTEX_ENDTURN_REQUIREMENTS: '1' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('isTaskShaped', () => {
  it('detects imperative task text', () => {
    expect(isTaskShaped('Write a compressor that beats gzip on this corpus')).toBe(true);
    expect(isTaskShaped('Fix the failing OCaml GC bug in this repo')).toBe(true);
  });
  it('rejects questions/short text', () => {
    expect(isTaskShaped('why is the sky blue?')).toBe(false);
    expect(isTaskShaped('hi')).toBe(false);
    expect(isTaskShaped('')).toBe(false);
  });
});

describe('verifyRequirements — Stage 4 table', () => {
  const task = 'Implement a compressor and make the tests pass';

  it('REJECTS empty requirements on a task-shaped turn', () => {
    const v = verifyRequirements({
      requirements: [],
      verification: [],
      userTaskText: task,
      turnUsedMutatingTool: false,
    });
    expect(v.ok).toBe(false);
    expect(v.nudge).toMatch(/enumerated no requirements/i);
  });

  it('REJECTS missing requirements field on a task-shaped turn', () => {
    const v = verifyRequirements({
      requirements: undefined,
      verification: [],
      userTaskText: task,
      turnUsedMutatingTool: false,
    });
    expect(v.ok).toBe(false);
  });

  it('accepts empty requirements on a NON-task turn (no false nudge)', () => {
    const v = verifyRequirements({
      requirements: [],
      verification: [],
      userTaskText: 'what does this error mean?',
      turnUsedMutatingTool: false,
    });
    expect(v.ok).toBe(true);
  });

  it('REJECTS a malformed row, naming its position', () => {
    const v = verifyRequirements({
      requirements: [cleanRow, { requirement: 'x' }],
      verification: [{ command: 'ls', observed_result: 'ok' }],
      userTaskText: task,
      turnUsedMutatingTool: false,
    });
    expect(v.ok).toBe(false);
    expect(v.nudge).toMatch(/row 2 is malformed/i);
  });

  it('REJECTS UNVERIFIED rows, naming them', () => {
    const v = verifyRequirements({
      requirements: [cleanRow, { ...cleanRow, requirement: 'handle empty input', verified_how: 'UNVERIFIED' }],
      verification: [{ command: 'python3 verify.py', observed_result: 'OK' }],
      userTaskText: task,
      turnUsedMutatingTool: true,
    });
    expect(v.ok).toBe(false);
    expect(v.nudge).toMatch(/UNVERIFIED/);
    expect(v.nudge).toMatch(/handle empty input/);
  });

  it('UNVERIFIED match is case-insensitive and whitespace-tolerant', () => {
    const v = verifyRequirements({
      requirements: [{ ...cleanRow, verified_how: '  unverified ' }],
      verification: [],
      userTaskText: task,
      turnUsedMutatingTool: false,
    });
    expect(v.ok).toBe(false);
  });

  it('REJECTS mutating turn with empty verification (ran no checks)', () => {
    const v = verifyRequirements({
      requirements: [cleanRow],
      verification: [],
      userTaskText: task,
      turnUsedMutatingTool: true,
    });
    expect(v.ok).toBe(false);
    expect(v.nudge).toMatch(/modified files.*verification.*empty/is);
  });

  it('PASSES a clean attestation', () => {
    const v = verifyRequirements({
      requirements: [cleanRow],
      verification: [{ command: 'python3 verify.py', observed_result: 'OK ratio=0.31' }],
      userTaskText: task,
      turnUsedMutatingTool: true,
    });
    expect(v.ok).toBe(true);
    expect(v.nudge).toBeUndefined();
  });

  it('PASSES a readish turn with rows verified and no verification commands', () => {
    const v = verifyRequirements({
      requirements: [{ ...cleanRow, verified_how: 'read the config at line 42 confirming the flag' }],
      verification: [],
      userTaskText: task,
      turnUsedMutatingTool: false,
    });
    expect(v.ok).toBe(true);
  });
});
