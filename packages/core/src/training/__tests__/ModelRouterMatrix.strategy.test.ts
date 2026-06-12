import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ModelRouterMatrix } from '../ModelRouterMatrix.js';
import { runBench, type HarnessRunner, type HarnessRunResult, type TaskSpec } from '../BenchRunner.js';

// The (model, temperature, strategy) effectiveness layer — a 3-field extension of
// the SAME matrix, NOT a standalone store. getScores/recommend (model routing) stay
// grouped by model; getStrategyScores/recommendStrategy add the arm dimension the
// auto-research PM reads to assign per-arm variation from data.

function rec(m: ModelRouterMatrix, over: Partial<Parameters<ModelRouterMatrix['record']>[0]> = {}): void {
  m.record({
    modelId: 'deepseek-v4-flash', taskType: 'T1',
    toolCallCount: 1, inputTokens: 100, outputTokens: 50, latencyMs: 1000,
    pass: true, qualitativeScore: 80,
    ...over,
  });
}

describe('ModelRouterMatrix — (model, temp, strategy) effectiveness layer', () => {
  let root: string;
  let m: ModelRouterMatrix;
  let savedTemp: string | undefined;
  let savedStrat: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-strat-'));
    m = new ModelRouterMatrix(root);
    savedTemp = process.env.CORTEX_SUBAGENT_TEMPERATURE;
    savedStrat = process.env.CORTEX_ARM_STRATEGY;
    delete process.env.CORTEX_SUBAGENT_TEMPERATURE;
    delete process.env.CORTEX_ARM_STRATEGY;
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (savedTemp === undefined) delete process.env.CORTEX_SUBAGENT_TEMPERATURE; else process.env.CORTEX_SUBAGENT_TEMPERATURE = savedTemp;
    if (savedStrat === undefined) delete process.env.CORTEX_ARM_STRATEGY; else process.env.CORTEX_ARM_STRATEGY = savedStrat;
  });

  it('persists temperature + strategy and round-trips via getRecords', () => {
    rec(m, { temperature: 0.7, strategy: 'risk-first' });
    const recs = m.getRecords({ taskType: 'T1' });
    expect(recs).toHaveLength(1);
    expect(recs[0]!.temperature).toBe(0.7);
    expect(recs[0]!.strategy).toBe('risk-first');
  });

  it('getStrategyScores splits arms by (model, temp, strategy); getScores stays model-only', () => {
    // same model + task, two distinct strategies/temps, different quality
    rec(m, { temperature: 0.2, strategy: 'precise', qualitativeScore: 95 });
    rec(m, { temperature: 0.2, strategy: 'precise', qualitativeScore: 95 });
    rec(m, { temperature: 0.9, strategy: 'creative', qualitativeScore: 40 });
    rec(m, { temperature: 0.9, strategy: 'creative', qualitativeScore: 40 });

    // model routing: ONE entry for the single model (unchanged behavior)
    const model = m.getScores('T1');
    expect(model).toHaveLength(1);
    expect(model[0]!.modelId).toBe('deepseek-v4-flash');

    // strategy routing: TWO arms, ranked best-first
    const arms = m.getStrategyScores('T1');
    expect(arms).toHaveLength(2);
    expect(arms[0]!.strategy).toBe('precise');
    expect(arms[0]!.temperature).toBe(0.2);
    expect(arms[1]!.strategy).toBe('creative');
    expect(arms[0]!.compositeScore).toBeGreaterThan(arms[1]!.compositeScore);
  });

  it('recommendStrategy returns the highest-composite arm with its temp + strategy', () => {
    rec(m, { temperature: 0.2, strategy: 'precise', qualitativeScore: 95 });
    rec(m, { temperature: 0.9, strategy: 'creative', qualitativeScore: 30 });
    const best = m.recommendStrategy('T1');
    expect(best).not.toBeNull();
    expect(best!.modelId).toBe('deepseek-v4-flash');
    expect(best!.strategy).toBe('precise');
    expect(best!.temperature).toBe(0.2);
  });

  it('recommendStrategy returns null for an unseen task (no cold-start guess for arms)', () => {
    expect(m.recommendStrategy('never-seen')).toBeNull();
  });

  it('buckets near-identical temperatures into the same arm', () => {
    rec(m, { temperature: 0.69, strategy: 's' });
    rec(m, { temperature: 0.71, strategy: 's' });
    const arms = m.getStrategyScores('T1');
    expect(arms).toHaveLength(1);          // 0.69 and 0.71 → same 0.7 bucket
    expect(arms[0]!.sampleCount).toBe(2);
  });

  it('back-compat: records with no temp/strategy form a single default arm', () => {
    rec(m, { qualitativeScore: 80 });
    rec(m, { qualitativeScore: 80 });
    const arms = m.getStrategyScores('T1');
    expect(arms).toHaveLength(1);
    expect(arms[0]!.temperature).toBeUndefined();
    expect(arms[0]!.strategy).toBeUndefined();
    // and model routing is wholly unaffected
    expect(m.recommend('T1')).toBe('deepseek-v4-flash');
  });

  it('record() auto-stamps temperature + strategy from env when not passed', () => {
    process.env.CORTEX_SUBAGENT_TEMPERATURE = '0.5';
    process.env.CORTEX_ARM_STRATEGY = 'mvp-first';
    rec(m); // no explicit temp/strategy
    const r = m.getRecords({ taskType: 'T1' })[0]!;
    expect(r.temperature).toBe(0.5);
    expect(r.strategy).toBe('mvp-first');
  });

  it('compaction preserves the arm distinction (summaries keyed by model+task+temp+strategy)', () => {
    const small = new ModelRouterMatrix(root, 200); // tiny cap → forces compaction
    for (let i = 0; i < 20; i++) {
      small.record({ modelId: 'deepseek-v4-flash', taskType: 'T1', toolCallCount: 1, inputTokens: 100, outputTokens: 50, latencyMs: 1000, pass: true, qualitativeScore: 95, temperature: 0.2, strategy: 'precise' });
      small.record({ modelId: 'deepseek-v4-flash', taskType: 'T1', toolCallCount: 1, inputTokens: 100, outputTokens: 50, latencyMs: 1000, pass: false, qualitativeScore: 20, temperature: 0.9, strategy: 'creative' });
    }
    // after compaction, the two strategies must remain separable
    const arms = small.getStrategyScores('T1');
    expect(arms.map(a => a.strategy).sort()).toEqual(['creative', 'precise']);
    expect(arms[0]!.strategy).toBe('precise'); // still ranked best-first
  });
});

describe('runBench — threads temperature + strategy into the matrix', () => {
  let root: string;
  let m: ModelRouterMatrix;

  function mockRunner(modelId = 'deepseek-v4-flash'): HarnessRunner {
    return {
      async run(): Promise<HarnessRunResult> {
        return { text: 'STOP null softBudget', modelId, inputTokens: 100, outputTokens: 50, toolCallCount: 1, latencyMs: 1000 };
      },
    };
  }
  const task: TaskSpec = {
    id: 't', taskType: 'T1', prompt: 'Quote STOP null softBudget.',
    verifier: { type: 'contains', all: ['STOP', 'null', 'softBudget'] },
  };

  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchstrat-')); m = new ModelRouterMatrix(root); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('records the arm temperature + strategy passed in RunBenchOptions', async () => {
    await runBench([task], mockRunner(), m, { experimentTag: 'e', runs: 2, temperature: 0.3, strategy: 'risk-first' });
    const recs = m.getRecords({ taskType: 'T1' });
    expect(recs).toHaveLength(2);
    expect(recs.every(r => r.temperature === 0.3 && r.strategy === 'risk-first')).toBe(true);
    const best = m.recommendStrategy('T1');
    expect(best!.strategy).toBe('risk-first');
  });
});
