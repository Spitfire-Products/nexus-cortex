import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ModelRouterMatrix } from '../ModelRouterMatrix.js';
import {
  gradeRun, runBench, parseTaskSet,
  type HarnessRunner, type HarnessRunResult, type TaskSpec, type Verifier,
} from '../BenchRunner.js';

describe('gradeRun — deterministic verifiers', () => {
  it('exact: normalized equality', async () => {
    expect((await gradeRun('  Hello   World ', { type: 'exact', expected: 'hello world', normalize: true })).pass).toBe(true);
    expect((await gradeRun('Hello World', { type: 'exact', expected: 'goodbye', normalize: true })).qualitativeScore).toBe(0);
  });

  it('regex: pattern match', async () => {
    expect((await gradeRun('version 4.6.0', { type: 'regex', pattern: '\\d+\\.\\d+\\.\\d+' })).pass).toBe(true);
    expect((await gradeRun('no number', { type: 'regex', pattern: '\\d+\\.\\d+\\.\\d+' })).pass).toBe(false);
  });

  it('contains: PARTIAL CREDIT graded score', async () => {
    const v: Verifier = { type: 'contains', all: ['alpha', 'beta', 'gamma', 'delta'] };
    const g = await gradeRun('alpha and gamma present', v);
    expect(g.qualitativeScore).toBe(50);   // 2 of 4
    expect(g.pass).toBe(false);
    const full = await gradeRun('alpha beta gamma delta', v);
    expect(full.qualitativeScore).toBe(100);
    expect(full.pass).toBe(true);
  });

  it('contains: caseInsensitive', async () => {
    const g = await gradeRun('ALPHA Beta', { type: 'contains', all: ['alpha', 'beta'], caseInsensitive: true });
    expect(g.qualitativeScore).toBe(100);
  });

  it('llm-judge: requires an injected judge, else throws', async () => {
    await expect(gradeRun('x', { type: 'llm-judge', rubric: 'is it good' })).rejects.toThrow(/requires an injected/);
    const g = await gradeRun('x', { type: 'llm-judge', rubric: 'r' }, async () => ({ pass: true, qualitativeScore: 88 }));
    expect(g.qualitativeScore).toBe(88);
  });
});

// A scripted mock runner: returns a fixed output per call (so grades are deterministic).
function mockRunner(outputs: string[], modelId = 'deepseek-v4-flash'): HarnessRunner {
  let i = 0;
  return {
    async run(): Promise<HarnessRunResult> {
      const text = outputs[Math.min(i, outputs.length - 1)]!;
      i++;
      return { text, modelId, inputTokens: 100, outputTokens: 50, toolCallCount: 1, latencyMs: 1234 };
    },
  };
}

describe('runBench — execute, grade, record REAL scores', () => {
  let root: string;
  let matrix: ModelRouterMatrix;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchrun-'));
    matrix = new ModelRouterMatrix(root);
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  const task: TaskSpec = {
    id: 'quote-budget-signal', taskType: 'T1',
    prompt: 'Quote the firm STOP return and the null condition.',
    verifier: { type: 'contains', all: ['STOP', 'null', 'softBudget'] },
  };

  it('writes a scored record per run with real (non-stub) qualitativeScore', async () => {
    // output contains 2 of 3 needles → score 67
    const runner = mockRunner(['returns STOP when softBudget exceeded']);
    const summary = await runBench([task], runner, matrix, { experimentTag: 'swarm-01', runs: 3, split: 'train', modelId: 'deepseek-v4-flash' });

    expect(summary.totalRuns).toBe(3);
    expect(summary.tasks[0]!.meanScore).toBe(67); // 2/3 each run
    // records actually landed in the matrix with the real score (NOT the flat 75 stub)
    const recs = matrix.getRecords({ experimentTag: 'swarm-01', split: 'train' });
    expect(recs).toHaveLength(3);
    expect(recs.every(r => r.qualitativeScore === 67)).toBe(true);
    expect(recs[0]!.taskFingerprint).toBeDefined();
  });

  it('harnessRef override enables single-box base-vs-candidate', async () => {
    await runBench([task], mockRunner(['STOP']), matrix, { experimentTag: 'e', runs: 2, harnessRef: 'base-sha' });
    await runBench([task], mockRunner(['STOP null softBudget']), matrix, { experimentTag: 'e', runs: 2, harnessRef: 'cand-sha' });
    const base = matrix.getRecords({ harnessRef: 'base-sha' });
    const cand = matrix.getRecords({ harnessRef: 'cand-sha' });
    expect(base).toHaveLength(2);
    expect(cand).toHaveLength(2);
    expect(base[0]!.qualitativeScore).toBe(33);   // 1/3
    expect(cand[0]!.qualitativeScore).toBe(100);  // 3/3
    // same task → same fingerprint across arms (the comparability key)
    expect(base[0]!.taskFingerprint).toBe(cand[0]!.taskFingerprint);
  });

  it('split is honored (holdout records are tagged holdout)', async () => {
    await runBench([task], mockRunner(['STOP']), matrix, { experimentTag: 'e', runs: 1, split: 'holdout' });
    expect(matrix.getRecords({ split: 'holdout' })).toHaveLength(1);
    expect(matrix.getRecords({ split: 'train' })).toHaveLength(0);
  });
});

describe('parseTaskSet — validation', () => {
  it('accepts a valid task array and a single object', () => {
    expect(parseTaskSet([{ id: 'a', prompt: 'p', verifier: { type: 'exact', expected: 'x' } }])).toHaveLength(1);
    expect(parseTaskSet({ id: 'b', prompt: 'p', verifier: { type: 'regex', pattern: '.' } })).toHaveLength(1);
  });

  it('rejects malformed entries with a clear message', () => {
    expect(() => parseTaskSet([{ id: 'a', prompt: 'p' }])).toThrow(/missing 'verifier'/);
    expect(() => parseTaskSet([{ prompt: 'p', verifier: { type: 'exact', expected: 'x' } }])).toThrow(/missing 'id'/);
    expect(() => parseTaskSet([{ id: 'a', prompt: 'p', verifier: { type: 'bogus' } }])).toThrow(/verifier.type must be/);
  });
});
