import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExperimentLedger, type ExperimentTaskResult } from '../ExperimentLedger.js';

function tr(tag: string, fp: string, baseScore: number, candScore: number, baseN = 3, candN = 3): ExperimentTaskResult {
  return { experimentTag: tag, taskFingerprint: fp, baseScore, candScore, delta: 0, baseN, candN };
}

describe('ExperimentLedger — keep/discard decision record', () => {
  let root: string;
  let led: ExperimentLedger;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'expledger-'));
    led = new ExperimentLedger(root);
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('open() starts pending; never sets a decision at creation', () => {
    const e = led.open({ experimentTag: 'swarm-01', baseRef: 'aaa', candidateRef: 'bbb', branch: 'exp/loopfix' });
    expect(e.decision).toBe('pending');
    expect(e.createdAt).toBe(e.updatedAt);
    expect(e.results).toEqual([]);
    expect(e.nRuns).toBe(0);
  });

  it('normalizes delta and aggregates nRuns from results', () => {
    const e = led.open({
      experimentTag: 'swarm-02', baseRef: 'aaa', candidateRef: 'bbb', branch: 'exp/x',
      results: [tr('swarm-02', 'fp1', 70, 82, 2, 4), tr('swarm-02', 'fp2', 60, 58, 3, 3)],
    });
    expect(e.results[0]!.delta).toBe(12);
    expect(e.results[1]!.delta).toBe(-2);
    expect(e.results[0]!.experimentTag).toBe('swarm-02'); // child rows carry the join key
    expect(e.nRuns).toBe(2 + 4 + 3 + 3);
  });

  it('decide() is the only path to a non-pending decision; stamps MC stats', () => {
    led.open({ experimentTag: 'swarm-03', baseRef: 'aaa', candidateRef: 'bbb', branch: 'exp/x' });
    const decided = led.decide('swarm-03', {
      decision: 'keep', pValue: 0.012, ciLow: 1.4, ciHigh: 9.8, fwerAdjusted: true, nRuns: 20, reason: 'beats base on T1',
    })!;
    expect(decided.decision).toBe('keep');
    expect(decided.pValue).toBe(0.012);
    expect(decided.fwerAdjusted).toBe(true);
    expect(decided.ciLow).toBe(1.4);
    expect(decided.reason).toBe('beats base on T1');
  });

  it('setResults() replaces comparisons and recomputes nRuns', () => {
    led.open({ experimentTag: 'swarm-04', baseRef: 'aaa', candidateRef: 'bbb', branch: 'exp/x' });
    const up = led.setResults('swarm-04', [tr('swarm-04', 'fp1', 50, 60, 5, 5)])!;
    expect(up.results).toHaveLength(1);
    expect(up.results[0]!.delta).toBe(10);
    expect(up.nRuns).toBe(10);
  });

  it('pending() lists only undecided experiments', () => {
    led.open({ experimentTag: 'a', baseRef: 'r', candidateRef: 'c', branch: 'b' });
    led.open({ experimentTag: 'b', baseRef: 'r', candidateRef: 'c', branch: 'b' });
    led.decide('a', { decision: 'discard' });
    expect(led.pending().map(e => e.experimentTag)).toEqual(['b']);
  });

  it('append-only: latest snapshot per experimentTag wins across instances', () => {
    led.open({ experimentTag: 'swarm-05', baseRef: 'aaa', candidateRef: 'bbb', branch: 'exp/x' });
    led.decide('swarm-05', { decision: 'keep', mergedCommit: 'deadbeef' });
    const led2 = new ExperimentLedger(root);
    const got = led2.get('swarm-05')!;
    expect(got.decision).toBe('keep');
    expect(got.mergedCommit).toBe('deadbeef');
    // exactly one logical record despite multiple appended lines
    expect(led2.list().filter(e => e.experimentTag === 'swarm-05')).toHaveLength(1);
  });

  it('allTaskResults() flattens child rows for external ledger ingest', () => {
    led.open({ experimentTag: 'x', baseRef: 'r', candidateRef: 'c', branch: 'b', results: [tr('x', 'fp1', 1, 2)] });
    led.open({ experimentTag: 'y', baseRef: 'r', candidateRef: 'c', branch: 'b', results: [tr('y', 'fp2', 3, 4), tr('y', 'fp3', 5, 6)] });
    const rows = led.allTaskResults();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map(r => r.experimentTag))).toEqual(new Set(['x', 'y']));
  });
});
