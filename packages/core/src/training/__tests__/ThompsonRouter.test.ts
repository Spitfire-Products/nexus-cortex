import { describe, it, expect } from 'vitest';
import { thompsonSelect } from '../ThompsonRouter.js';
import { mulberry32 } from '../AutoResearchStats.js';
import type { ModelScore } from '../ModelRouterMatrix.js';

function score(modelId: string, compositeScore: number, sampleCount: number): ModelScore {
  return {
    modelId, taskType: 'T1', compositeScore,
    components: { correctness: 0, efficiency: 0, speed: 0, cost: 0 },
    sampleCount, avgPassRate: 0, avgQualitativeScore: 0, avgToolCalls: 0,
    avgInputTokens: 0, avgOutputTokens: 0, avgLatencyMs: 0, avgCostCents: 0,
  };
}

describe('ThompsonRouter — explore/exploit posterior sampling', () => {
  it('returns null for empty input', () => {
    expect(thompsonSelect([], { rng: mulberry32(1) })).toBeNull();
  });

  it('excluded models are never selected', () => {
    const scores = [score('grok-4.3', 99, 100), score('deepseek-v4-flash', 70, 100)];
    for (let s = 0; s < 50; s++) {
      const pick = thompsonSelect(scores, { rng: mulberry32(s), exclude: ['grok-4.3'] });
      expect(pick).toBe('deepseek-v4-flash');
    }
  });

  it('returns null when every model is excluded → caller falls back', () => {
    const scores = [score('grok-4.3', 99, 100)];
    expect(thompsonSelect(scores, { rng: mulberry32(1), exclude: ['grok-4.3'] })).toBeNull();
  });

  it("prefix wildcard 'grok*' excludes every xAI model (present and future)", () => {
    const scores = [
      score('grok-4.3', 99, 100), score('grok-code-fast-1', 98, 100),
      score('grok-9-future', 97, 100), score('deepseek-v4-flash', 70, 100),
    ];
    for (let s = 0; s < 50; s++) {
      expect(thompsonSelect(scores, { rng: mulberry32(s), exclude: ['grok*'] })).toBe('deepseek-v4-flash');
    }
    // a non-grok model is untouched by the grok* rule
    expect(thompsonSelect([score('deepseek-chat', 80, 100)], { rng: mulberry32(1), exclude: ['grok*'] })).toBe('deepseek-chat');
  });

  it('exploits: a high-mean, well-sampled model wins the large majority of draws', () => {
    const scores = [score('strong', 90, 500), score('weak', 60, 500)];
    let strongWins = 0;
    const N = 400;
    for (let s = 0; s < N; s++) if (thompsonSelect(scores, { rng: mulberry32(s) }) === 'strong') strongWins++;
    expect(strongWins / N).toBeGreaterThan(0.95); // tight posteriors → near-deterministic
  });

  it('explores: a thinly-sampled underdog still wins some draws (posterior is wide)', () => {
    // mean gap of 8 but the underdog has 0 samples → wide sd → occasional wins.
    const scores = [score('proven', 80, 500), score('coldstart', 72, 0)];
    let coldWins = 0;
    const N = 400;
    for (let s = 0; s < N; s++) if (thompsonSelect(scores, { rng: mulberry32(s) }) === 'coldstart') coldWins++;
    expect(coldWins).toBeGreaterThan(0);          // it explores
    expect(coldWins / N).toBeLessThan(0.5);        // but doesn't dominate the proven model
  });

  it('is deterministic under a fixed seed', () => {
    const scores = [score('a', 80, 10), score('b', 78, 5), score('c', 60, 0)];
    expect(thompsonSelect(scores, { rng: mulberry32(42) })).toBe(thompsonSelect(scores, { rng: mulberry32(42) }));
  });

  it('minSpread floor keeps a sliver of jitter even at huge sample counts', () => {
    // two near-identical means, both heavily sampled: with minSpread>0 the loser
    // should still occasionally win across many seeds (not fully locked in).
    const scores = [score('x', 80.0, 100000), score('y', 80.1, 100000)];
    const winners = new Set<string>();
    for (let s = 0; s < 200; s++) winners.add(thompsonSelect(scores, { rng: mulberry32(s), minSpread: 2 })!);
    expect(winners.size).toBe(2);
  });
});
