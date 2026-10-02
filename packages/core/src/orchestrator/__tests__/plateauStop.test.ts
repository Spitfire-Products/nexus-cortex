import { describe, it, expect } from 'vitest';
import {
  resolvePlateauStop, plateauBootInstruction, parsePlateauMetrics, decidePlateau, buildPlateauReminder, formatPct,
  PlateauStopTracker, PLATEAU_DEFAULTS, plateauStatusSegment, resolvePlateauMode,
} from '../plateauStop.js';
import { buildTurnStatusLine } from '../turnStatus.js';

const ON = { CORTEX_PLATEAU_STOP: 'on' } as NodeJS.ProcessEnv;
const CFG = { rel: 0.002, window: 3, minPoints: 5 };
const line = (v: number, name = 'score', dir = 'max') => `PLATEAU_METRIC ${name}=${v} dir=${dir}`;

describe('R210 resolvePlateauStop', () => {
  it('off by default and for non-truthy values', () => {
    expect(resolvePlateauStop({} as NodeJS.ProcessEnv)).toBeNull();
    expect(resolvePlateauStop({ CORTEX_PLATEAU_STOP: 'off' } as NodeJS.ProcessEnv)).toBeNull();
  });
  it('on → defaults; numeric overrides; bad values fall back', () => {
    expect(resolvePlateauStop(ON)).toEqual(PLATEAU_DEFAULTS);
    expect(resolvePlateauStop({ ...ON, CORTEX_PLATEAU_REL: '0.01', CORTEX_PLATEAU_WINDOW: '4', CORTEX_PLATEAU_MIN_POINTS: '10' })).toEqual({ rel: 0.01, window: 4, minPoints: 10 });
    expect(resolvePlateauStop({ ...ON, CORTEX_PLATEAU_REL: 'x', CORTEX_PLATEAU_WINDOW: '0', CORTEX_PLATEAU_MIN_POINTS: '-3' })).toEqual(PLATEAU_DEFAULTS);
  });
});

describe('R210 parsePlateauMetrics', () => {
  it('finds lines inside noise, all occurrences, last wins per name', () => {
    const text = `epoch 3 loss 0.2\n${line(10)}\nwarn: blah PLATEAU_METRIC broken\n${line(0.5, 'err', 'min')}\n  ${line(12)} trailing\nPLATEAU_METRIC x=abc dir=max`;
    const m = parsePlateauMetrics(text);
    expect(m.get('score')).toEqual({ value: 12, dir: 'max' });
    expect(m.get('err')).toEqual({ value: 0.5, dir: 'min' });
    expect(m.has('x')).toBe(false);
  });
  it('accepts negative and exponent numbers; skips malformed numbers; empty on no marker', () => {
    expect(parsePlateauMetrics('PLATEAU_METRIC a=-1.5e3 dir=min').get('a')).toEqual({ value: -1500, dir: 'min' });
    expect(parsePlateauMetrics('PLATEAU_METRIC a=1.2.3 dir=max').size).toBe(0);
    expect(parsePlateauMetrics('PLATEAU_METRIC a=1 dir=up').size).toBe(0);
    expect(parsePlateauMetrics('nothing here').size).toBe(0);
  });
});

describe('R210 decidePlateau', () => {
  it('rising series → no plateau', () => {
    const d = decidePlateau([100, 110, 120, 130, 140, 150], 'max', CFG)!;
    expect(d.plateau).toBe(false);
    expect(d.improvement).toBeCloseTo((150 - 120) / 120);
    expect(d.best).toBe(150);
  });
  it('flat series → plateau (improvement 0 < rel)', () => {
    const d = decidePlateau([100, 100, 100, 100, 100, 100], 'max', CFG)!;
    expect(d.plateau).toBe(true);
    expect(d.improvement).toBe(0);
  });
  it('tiny gains below rel → plateau (the v39a shape)', () => {
    expect(decidePlateau([840636, 845000, 851000, 851100, 851300, 851547], 'max', CFG)!.plateau).toBe(true);
  });
  it('worse series → plateau with negative improvement', () => {
    const d = decidePlateau([100, 120, 130, 110, 105, 100], 'max', CFG)!;
    expect(d.plateau).toBe(true);
    expect(d.improvement).toBeLessThan(0);
    expect(d.best).toBe(130);
  });
  it('min direction: falling error is progress, flat is plateau, rising is worse', () => {
    expect(decidePlateau([1, 0.9, 0.8, 0.6, 0.5, 0.4], 'min', CFG)!.plateau).toBe(false);
    expect(decidePlateau([1, 0.9, 0.8, 0.8, 0.8, 0.8], 'min', CFG)!.plateau).toBe(true);
    const worse = decidePlateau([1, 0.5, 0.4, 0.6, 0.7, 0.9], 'min', CFG)!;
    expect(worse.plateau).toBe(true);
    expect(worse.improvement).toBeLessThan(0);
    expect(worse.best).toBe(0.4);
  });
  it('fewer than minPoints → no plateau even when flat', () => {
    expect(decidePlateau([5, 5, 5, 5], 'max', CFG)!.plateau).toBe(false);
    expect(decidePlateau([], 'max', CFG)).toBeNull();
  });
  it('window edges: n == window has nothing before it → no plateau; n == window + 1 compares against one point', () => {
    const wide = { rel: 0.002, window: 5, minPoints: 2 };
    expect(decidePlateau([7, 7, 7, 7, 7], 'max', wide)!.plateau).toBe(false);
    const d = decidePlateau([7, 7, 7, 7, 7, 7], 'max', wide)!;
    expect(d.plateau).toBe(true);
    expect(d.bestBefore).toBe(7);
  });
  it('gain exactly at rel is not a plateau; zero baseline uses the tiny floor', () => {
    expect(decidePlateau([1000, 1000, 1000, 1002, 1000], 'max', { rel: 0.002, window: 2, minPoints: 5 })!.plateau).toBe(false);
    expect(decidePlateau([0, 0, 0, 1, 0], 'max', { rel: 0.002, window: 2, minPoints: 5 })!.plateau).toBe(false);
    expect(decidePlateau([0, 0, 0, 0, 0], 'max', { rel: 0.002, window: 2, minPoints: 5 })!.plateau).toBe(true);
  });
});

describe('R210 reminder + formatting', () => {
  it('reminder names metric, window, target and best', () => {
    const d = decidePlateau([100, 100, 100, 100, 100.1, 100], 'max', CFG)!;
    const r = buildPlateauReminder('score', d, CFG);
    expect(r).toContain('PLATEAU: your score improved only 0.1% over the last 3 evaluations (target ≥ 0.2%). Stop optimizing.');
    expect(r).toContain('holds the best result (100.1)');
    expect(r).toContain("run the task's own verification/tests once, then finish.");
    expect(formatPct(-0.0123456)).toBe('-1.23');
  });
});

describe('R210 PlateauStopTracker', () => {
  it('lever off: no scanning, no series, no signal', () => {
    const t = new PlateauStopTracker();
    for (let i = 0; i < 20; i++) {
      const r = t.step([{ content: line(100) }], {} as NodeJS.ProcessEnv);
      expect(r).toEqual({ signal: null, newMetrics: [], fire: null });
    }
    expect(t.series.size).toBe(0);
    expect(plateauBootInstruction({} as NodeJS.ProcessEnv)).toBeNull();
  });
  it('boot instruction when on', () => {
    expect(plateauBootInstruction(ON)).toContain('PLATEAU_METRIC <name>=<number> dir=<max|min>');
  });
  it('one point per result per metric (last wins), newMetrics once, fires once at the plateau then waits a window', () => {
    const env = { ...ON, CORTEX_PLATEAU_WINDOW: '3', CORTEX_PLATEAU_MIN_POINTS: '5' } as NodeJS.ProcessEnv;
    const t = new PlateauStopTracker();
    const r0 = t.step([{ content: `${line(1)}\n${line(100)}` }, 'unrelated', { content: 42 }], env);
    expect(r0.newMetrics).toEqual([{ name: 'score', dir: 'max', value: 100 }]);
    expect(t.series.get('score')!.values).toEqual([100]);
    const fires: number[] = [];
    for (let i = 1; i < 12; i++) {
      const r = t.step([line(100)], env);
      expect(r.newMetrics).toEqual([]);
      if (r.fire) fires.push(r.fire.points);
      if (r.fire) expect(r.signal).toContain('PLATEAU: your score');
    }
    // first plateau at n=5, second only after >= window more points (n=8), then capped at 2
    expect(fires).toEqual([5, 8]);
    expect(t.firings).toBe(2);
  });
  it('a real gain after the first firing suppresses the second', () => {
    const env = { ...ON, CORTEX_PLATEAU_WINDOW: '3', CORTEX_PLATEAU_MIN_POINTS: '5' } as NodeJS.ProcessEnv;
    const t = new PlateauStopTracker();
    const vals = [100, 100, 100, 100, 100, 110, 120, 130, 140];
    const fires = vals.map((v) => t.step([line(v)], env).fire).filter(Boolean);
    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({ name: 'score', dir: 'max', best: 100, improvementPct: 0, points: 5, firing: 1 });
  });
  it('never throws on junk input', () => {
    const t = new PlateauStopTracker();
    expect(() => t.step([null, undefined, { content: { a: 1 } }, 5] as unknown[], ON)).not.toThrow();
  });
});

describe('R210 STATUS segment', () => {
  const env = { ...ON, CORTEX_PLATEAU_WINDOW: '3', CORTEX_PLATEAU_MIN_POINTS: '5' } as NodeJS.ProcessEnv;
  it('absent when the lever is off or no metric was seen', () => {
    const t = new PlateauStopTracker();
    expect(plateauStatusSegment(t, env)).toBeNull();
    expect(plateauStatusSegment(null, env)).toBeNull();
    t.step([line(5)], env);
    expect(plateauStatusSegment(t, {} as NodeJS.ProcessEnv)).toBeNull();
  });
  it('short series: best + count only', () => {
    const t = new PlateauStopTracker();
    t.step([line(5)], env);
    expect(plateauStatusSegment(t, env)).toBe('score score: best 5 (1 eval)');
    t.step([line(7)], env);
    expect(plateauStatusSegment(t, env)).toBe('score score: best 7 (2 evals)');
  });
  it('improvement part once comparable; PLATEAU suffix when the detector says plateau', () => {
    const t = new PlateauStopTracker();
    for (const v of [100, 110, 120, 130, 140]) t.step([line(v)], env);
    expect(plateauStatusSegment(t, env)).toBe('score score: best 140 (5 evals); +27.3% over last 3 (target ≥0.2%)');
    const t2 = new PlateauStopTracker();
    for (const v of [100, 120, 110, 105, 100]) t2.step([line(v)], env);
    expect(plateauStatusSegment(t2, env)).toBe('score score: best 120 (5 evals); -8.33% over last 3 (target ≥0.2%) — PLATEAU');
  });
  it('most recently reported metric wins', () => {
    const t = new PlateauStopTracker();
    t.step([line(5), line(0.3, 'latency', 'min')], env);
    expect(plateauStatusSegment(t, env)).toBe('score latency: best 0.3 (1 eval)');
    t.step([line(6)], env);
    expect(plateauStatusSegment(t, env)).toBe('score score: best 6 (2 evals)');
  });
  it('buildTurnStatusLine: null/absent segment → byte-identical; present → one extra segment at the end', () => {
    const base = { elapsedMs: 60_000, deadlineMs: 3_600_000, contextTokens: 5000, contextWindow: 100_000, shells: [], nowMs: 0 };
    const plain = buildTurnStatusLine(base);
    expect(buildTurnStatusLine({ ...base, plateau: null })).toBe(plain);
    expect(buildTurnStatusLine({ ...base, plateau: undefined })).toBe(plain);
    expect(buildTurnStatusLine({ ...base, plateau: 'score s: best 1 (1 eval)' })).toBe(plain.replace('</system-reminder>', '; score s: best 1 (1 eval)</system-reminder>'));
  });
});

describe('R210 CORTEX_PLATEAU_STOP modes (off | on | status)', () => {
  const STATUS = { CORTEX_PLATEAU_STOP: 'status', CORTEX_PLATEAU_WINDOW: '3', CORTEX_PLATEAU_MIN_POINTS: '5' } as NodeJS.ProcessEnv;
  const ONW = { CORTEX_PLATEAU_STOP: 'on', CORTEX_PLATEAU_WINDOW: '3', CORTEX_PLATEAU_MIN_POINTS: '5' } as NodeJS.ProcessEnv;
  const flat = [100, 101, 101, 101, 101, 101, 101, 101, 101, 101];
  it('resolvePlateauMode: unset/off/junk → null; on|true|1 → on; status (any case) → status', () => {
    expect(resolvePlateauMode({} as NodeJS.ProcessEnv)).toBeNull();
    expect(resolvePlateauMode({ CORTEX_PLATEAU_STOP: 'off' } as NodeJS.ProcessEnv)).toBeNull();
    expect(resolvePlateauMode({ CORTEX_PLATEAU_STOP: 'stat' } as NodeJS.ProcessEnv)).toBeNull();
    expect(resolvePlateauMode({ CORTEX_PLATEAU_STOP: 'TRUE' } as NodeJS.ProcessEnv)).toBe('on');
    expect(resolvePlateauMode({ CORTEX_PLATEAU_STOP: ' Status ' } as NodeJS.ProcessEnv)).toBe('status');
    expect(resolvePlateauStop({ CORTEX_PLATEAU_STOP: 'status' } as NodeJS.ProcessEnv)).toEqual(PLATEAU_DEFAULTS);
  });
  it('off: no instruction, no tracking, no segment', () => {
    const t = new PlateauStopTracker();
    for (const v of flat) expect(t.step([line(v)], {} as NodeJS.ProcessEnv)).toEqual({ signal: null, newMetrics: [], fire: null });
    expect(t.series.size).toBe(0);
    expect(plateauBootInstruction({} as NodeJS.ProcessEnv)).toBeNull();
    expect(plateauStatusSegment(t, {} as NodeJS.ProcessEnv)).toBeNull();
  });
  it('on: unchanged — reminders fire, no `detected` field, segment carries the PLATEAU label', () => {
    const t = new PlateauStopTracker();
    const rs = flat.map((v) => t.step([line(v)], ONW));
    expect(rs.filter((r) => r.signal).length).toBe(2);
    expect(rs.filter((r) => r.fire).map((r) => r.fire!.points)).toEqual([5, 8]);
    expect(rs.every((r) => !('detected' in r))).toBe(true);
    expect(plateauStatusSegment(t, ONW)).toMatch(/ — PLATEAU$/);
  });
  it('status: same instruction + tracking + segment numbers, NO reminder and NO fire; detected at the points `on` would fire', () => {
    expect(plateauBootInstruction(STATUS)).toBe(plateauBootInstruction(ONW));
    const t = new PlateauStopTracker();
    const rs = flat.map((v) => t.step([line(v)], STATUS));
    expect(rs.every((r) => r.signal === null && r.fire === null)).toBe(true);
    expect(rs.filter((r) => r.detected).map((r) => r.detected!.points)).toEqual([5, 8]);
    expect(rs[0]!.newMetrics).toEqual([{ name: 'score', dir: 'max', value: 100 }]);
    expect(t.series.get('score')!.values).toEqual(flat);
    const seg = plateauStatusSegment(t, STATUS)!;
    const segOn = (() => { const u = new PlateauStopTracker(); for (const v of flat) u.step([line(v)], ONW); return plateauStatusSegment(u, ONW)!; })();
    expect(seg).toBe(segOn.replace(/ — PLATEAU$/, ''));
    expect(seg).not.toMatch(/PLATEAU/);
  });
});
