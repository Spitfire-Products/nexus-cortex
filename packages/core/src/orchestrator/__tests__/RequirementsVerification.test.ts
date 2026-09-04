/**
 * EndTurn Stage 4 — requirements attestation (backlog item 1).
 * Unit table: empty reqs on task-shaped turn / malformed row / UNVERIFIED
 * row / mutating-turn-no-checks / clean pass — plus mode + task-shape edges.
 */

import { describe, it, expect } from 'vitest';
import {
  verifyRequirements,
  resolveEndTurnRequirementsMode,
  resolveEndTurnRequirementsStrict,
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

  it('STRICT: treats "UNVERIFIED (reason)" as unverified (4c way-out), not a claim (4e loop) — strict-audit fix', () => {
    const v = verifyRequirements({
      requirements: [{ ...cleanRow, verified_how: 'UNVERIFIED (no hidden tests in the sandbox)' }],
      verification: [],
      userTaskText: task,
      turnUsedMutatingTool: false,
      strict: true,
      toolOutputs: '',
    });
    expect(v.ok).toBe(false);
    // The correct rejection is the UNVERIFIED nudge (offers a way out — move to open_items),
    // NOT strict 4e "claims, not runs" (which loops, since the model already admitted it couldn't verify).
    expect(v.nudge).toMatch(/UNVERIFIED/);
    expect(v.nudge).not.toMatch(/claims, not runs/);
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

describe('verifyRequirements — STRICT mode (CORTEX_ENDTURN_REQUIREMENTS=strict, item 10)', () => {
  const task = 'Implement `dna_insert` in insert.py so that inserting AGCT at position 3 yields the 12-bp sequence; write results to /app/out.fasta';
  const okRow = {
    requirement: 'write results to /app/out.fasta',
    satisfied_by: 'insert.py writes out.fasta',
    verified_how: 'ls -l /app/out.fasta → -rw-r--r-- 1 root root 13 out.fasta',
  };
  const outputs = 'total 4\n-rw-r--r-- 1 root root 13 Sep  2 22:00 out.fasta\n';

  it('mode resolvers: strict implies mode on, and strict flag only for "strict"', () => {
    expect(resolveEndTurnRequirementsMode({ CORTEX_ENDTURN_REQUIREMENTS: 'strict' } as any)).toBe(true);
    expect(resolveEndTurnRequirementsStrict({ CORTEX_ENDTURN_REQUIREMENTS: 'strict' } as any)).toBe(true);
    expect(resolveEndTurnRequirementsStrict({ CORTEX_ENDTURN_REQUIREMENTS: 'true' } as any)).toBe(false);
    expect(resolveEndTurnRequirementsStrict({} as any)).toBe(false);
  });

  it('non-strict accepts a paraphrased requirement with an ungrounded claim (legacy behaviour unchanged)', () => {
    const v = verifyRequirements({
      requirements: [{ requirement: 'output file exists', satisfied_by: 'x', verified_how: 'checked it manually' }],
      verification: ['ls'], userTaskText: task, turnUsedMutatingTool: true, strict: false, toolOutputs: outputs,
    });
    expect(v.ok).toBe(true);
  });

  it('strict rejects a PARAPHRASED requirement (must be a verbatim task clause)', () => {
    const v = verifyRequirements({
      requirements: [{ ...okRow, requirement: 'the output fasta file must exist' }],
      verification: ['ls'], userTaskText: task, turnUsedMutatingTool: true, strict: true, toolOutputs: outputs,
    });
    expect(v.ok).toBe(false);
    expect(v.nudge).toMatch(/paraphrases, not the task's own words/);
  });

  it('strict rejects a verified_how that is a CLAIM with no matching tool output this turn', () => {
    const v = verifyRequirements({
      requirements: [{ ...okRow, verified_how: 'ran the unit tests and they all passed cleanly' }],
      verification: ['pytest'], userTaskText: task, turnUsedMutatingTool: true, strict: true, toolOutputs: outputs,
    });
    expect(v.ok).toBe(false);
    expect(v.nudge).toMatch(/claims, not runs/);
  });

  it('strict accepts a verbatim requirement whose verified_how quotes real tool output', () => {
    const v = verifyRequirements({
      requirements: [okRow],
      verification: ['ls -l /app/out.fasta'], userTaskText: task, turnUsedMutatingTool: true, strict: true, toolOutputs: outputs,
    });
    expect(v.ok).toBe(true);
  });

  it('strict is whitespace/case-insensitive on the verbatim check', () => {
    const v = verifyRequirements({
      requirements: [{ ...okRow, requirement: 'Write  results to /APP/out.fasta' }],
      verification: ['ls'], userTaskText: task, turnUsedMutatingTool: true, strict: true, toolOutputs: outputs,
    });
    expect(v.ok).toBe(true);
  });

  it('D-C fix: strict ACCEPTS a short command→output claim whose scaffold breaks the 12-char window', () => {
    // Repro of the verified D-C bug: `$ ls /app → "run.py"` — command + output BOTH present in the
    // corpus but split by the `$ → "` scaffold, so no 12-char window matches. The content-token
    // fallback (≥70% of ≥4-char tokens present) must ground it. Was an unwinnable rejection loop.
    const t = 'Write the function to /app/run.py and print the result';
    const v = verifyRequirements({
      requirements: [{ requirement: 'Write the function to /app/run.py', satisfied_by: 'main.py', verified_how: '$ ls /app → "run.py"' }],
      verification: ['ls /app'], userTaskText: t, turnUsedMutatingTool: true, strict: true, toolOutputs: 'ls /app\nrun.py\n',
    });
    expect(v.ok).toBe(true);
  });

  it('D-C guard: the fallback does NOT over-accept a claim whose tokens are absent from the output', () => {
    const v = verifyRequirements({
      requirements: [okRow],
      verification: ['pytest'], userTaskText: task, turnUsedMutatingTool: true, strict: true,
      toolOutputs: 'ls /app\nrun.py\n', // okRow.verified_how mentions out.fasta — not in this output
    });
    expect(v.ok).toBe(false);
    expect(v.nudge).toMatch(/claims, not runs/);
  });

  it('strict still lets UNVERIFIED rows fall through to the 4c nudge (not the grounding check)', () => {
    const v = verifyRequirements({
      requirements: [{ ...okRow, verified_how: 'UNVERIFIED' }],
      verification: ['ls'], userTaskText: task, turnUsedMutatingTool: true, strict: true, toolOutputs: outputs,
    });
    expect(v.ok).toBe(false);
    expect(v.nudge).toMatch(/UNVERIFIED/);
  });

  it('strict does not block when the task text is unknown (empty userTaskText)', () => {
    const v = verifyRequirements({
      requirements: [{ ...okRow, requirement: 'some paraphrase of a requirement' }],
      verification: ['ls'], userTaskText: '', turnUsedMutatingTool: false, strict: true, toolOutputs: outputs,
    });
    expect(v.ok).toBe(true);
  });
});

describe('verifyRequirements — STRICT 4.90.1 regressions', () => {
  const task = 'Design a gBlock. The gBlock must be stored in /app/gblock.txt containing only the sequence, with no empty lines and no header. Write the best move to /app/move.txt';
  it('does NOT throw on EndTurn({}) (no requirements) under strict — v4 dna-insert crash', () => {
    expect(() => verifyRequirements({ requirements: undefined, verification: [], userTaskText: 'hello there', turnUsedMutatingTool: false, strict: true, toolOutputs: '' })).not.toThrow();
    const v = verifyRequirements({ requirements: null, verification: [], userTaskText: 'hello there', turnUsedMutatingTool: false, strict: true, toolOutputs: '' });
    expect(v.ok).toBe(true);
  });
  it('accepts an honestly CONDENSED requirement that carries the task\'s own words (v4 protein-assembly)', () => {
    const v = verifyRequirements({
      requirements: [{ requirement: 'gBlock stored in /app/gblock.txt containing only the sequence, no empty lines', satisfied_by: 'x', verified_how: 'wc -l /app/gblock.txt → 1 /app/gblock.txt' }],
      verification: ['wc'], userTaskText: task, turnUsedMutatingTool: true, strict: true, toolOutputs: '1 /app/gblock.txt\n',
    });
    expect(v.ok).toBe(true);
  });
  it('still rejects a requirement with none of the task\'s words', () => {
    const v = verifyRequirements({
      requirements: [{ requirement: 'the deliverable exists and looks reasonable overall', satisfied_by: 'x', verified_how: 'wc -l /app/gblock.txt → 1 /app/gblock.txt' }],
      verification: ['wc'], userTaskText: task, turnUsedMutatingTool: true, strict: true, toolOutputs: '1 /app/gblock.txt\n',
    });
    expect(v.ok).toBe(false);
    expect(v.nudge).toMatch(/paraphrases/);
  });
});
