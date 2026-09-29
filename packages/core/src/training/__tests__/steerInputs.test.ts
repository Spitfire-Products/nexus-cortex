import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSteerInputs, clipIn, FULL_CAPS, resolveInventory, resolveInventoryPath } from '../steerInputs.js';
import { buildResolverUserPrompt } from '../endTurnResolver.js';
import { buildPlannerUserPrompt } from '../liftPlanner.js';

// CORTEX_STEER_INPUTS=full / CORTEX_INVENTORY=1 (dark, 2026-09-29). r-steering-input-truncation-2026-09-29: every steering prompt sliced its
// inputs with no marker (judge delta cut in 56% of verdicts, judge/exit plan in >=62%, planner saw 2000 of the TB4 orient output in 100%).
describe('steerInputs — resolveSteerInputs', () => {
  it('is off by default and only "full" turns it on', () => {
    expect(resolveSteerInputs({} as NodeJS.ProcessEnv)).toBe('default');
    expect(resolveSteerInputs({ CORTEX_STEER_INPUTS: 'full' } as any)).toBe('full');
    expect(resolveSteerInputs({ CORTEX_STEER_INPUTS: ' FULL ' } as any)).toBe('full');
    expect(resolveSteerInputs({ CORTEX_STEER_INPUTS: 'yes' } as any)).toBe('default');
  });
});

describe('steerInputs — clipIn', () => {
  const off = {} as NodeJS.ProcessEnv;
  const on = { CORTEX_STEER_INPUTS: 'full' } as any;
  it('default mode = the old silent head slice, byte for byte', () => {
    const s = 'x'.repeat(5000);
    expect(clipIn(s, 3500, FULL_CAPS.plan, 'plan', 'hint', off)).toBe(s.slice(0, 3500));
    expect(clipIn('short', 3500, FULL_CAPS.plan, 'plan', 'hint', off)).toBe('short');
  });
  it('full mode keeps text under the larger cap whole (no marker)', () => {
    const s = 'y'.repeat(8641); // the longest banked lift plan
    expect(clipIn(s, 3500, FULL_CAPS.plan, 'the lift plan', 'delivered in full at lift', on)).toBe(s);
  });
  it('full mode marks what it cuts: how much, of what, and how to get it', () => {
    const s = 'z'.repeat(FULL_CAPS.delta + 250);
    const out = clipIn(s, 6000, FULL_CAPS.delta, 'the workspace delta', 'the files are in the workspace', on);
    expect(out.startsWith('z'.repeat(FULL_CAPS.delta))).toBe(true);
    expect(out).toContain('[… 250 more chars of the workspace delta not shown — the files are in the workspace]');
  });
  it('full mode without a hint still says how much was cut', () => {
    expect(clipIn('a'.repeat(20), 5, 10, 'x', undefined, on)).toBe('a'.repeat(10) + '\n[… 10 more chars of x not shown]');
  });
  it('tolerates empty/undefined input', () => {
    expect(clipIn(undefined as any, 10, 20, 'x', undefined, on)).toBe('');
    expect(clipIn('', 10, 20, 'x', undefined, off)).toBe('');
  });
  it('every full cap is at least the old cap (full never shows LESS than default)', () => {
    for (const v of Object.values(FULL_CAPS)) expect(v).toBeGreaterThanOrEqual(6000);
  });
});

describe('steerInputs — inventory', () => {
  it('CORTEX_INVENTORY=1 turns it on; default off', () => {
    expect(resolveInventory({} as NodeJS.ProcessEnv)).toBe(false);
    expect(resolveInventory({ CORTEX_INVENTORY: '1' } as any)).toBe(true);
    expect(resolveInventory({ CORTEX_INVENTORY: 'true' } as any)).toBe(true);
  });
  it('resolves <project>/.cortex/inventory first, then $CORTEX_ROOT/.cortex/inventory, else undefined', () => {
    const proj = mkdtempSync(join(tmpdir(), 'inv-proj-')); const root = mkdtempSync(join(tmpdir(), 'inv-root-'));
    mkdirSync(join(root, '.cortex')); writeFileSync(join(root, '.cortex', 'inventory'), '#!/bin/sh\n');
    expect(resolveInventoryPath(proj, { CORTEX_ROOT: root } as any)).toBe(join(root, '.cortex', 'inventory'));
    mkdirSync(join(proj, '.cortex')); writeFileSync(join(proj, '.cortex', 'inventory'), '#!/bin/sh\n');
    expect(resolveInventoryPath(proj, { CORTEX_ROOT: root } as any)).toBe(join(proj, '.cortex', 'inventory'));
    expect(resolveInventoryPath(mkdtempSync(join(tmpdir(), 'inv-none-')), {} as any)).toBeUndefined();
  });
});


describe('steerInputs — prompt builders (default unchanged, full = whole + marked)', () => {
  const plan = 'P'.repeat(8641); const delta = 'D'.repeat(9000); const obs = 'O'.repeat(2766);
  const ctx: any = { task: 'fix it', liftPlan: plan, envReport: 'env', workspaceDelta: delta, checkResult: '', workProduct: 'done', attestation: 'ok' };
  const withEnv = <T,>(v: string | undefined, f: () => T): T => {
    const prev = process.env.CORTEX_STEER_INPUTS;
    if (v === undefined) delete process.env.CORTEX_STEER_INPUTS; else process.env.CORTEX_STEER_INPUTS = v;
    try { return f(); } finally { if (prev === undefined) delete process.env.CORTEX_STEER_INPUTS; else process.env.CORTEX_STEER_INPUTS = prev; }
  };
  it('judge prompt, default: plan cut at 3500 and delta at 6000 with no marker (the measured silent cut)', () => {
    const p = withEnv(undefined, () => buildResolverUserPrompt(ctx));
    expect(p).toContain('P'.repeat(3500)); expect(p).not.toContain('P'.repeat(3501));
    expect(p).toContain('D'.repeat(6000)); expect(p).not.toContain('D'.repeat(6001));
    expect(p).not.toContain('not shown');
  });
  it('judge prompt, full: the whole 8.6K plan and 9K delta reach the judge', () => {
    const p = withEnv('full', () => buildResolverUserPrompt(ctx));
    expect(p).toContain(plan); expect(p).toContain(delta); expect(p).not.toContain('not shown');
  });
  it('judge prompt, full: an over-cap delta is cut WITH a marker naming what was cut', () => {
    const big: any = { ...ctx, workspaceDelta: 'D'.repeat(20000) };
    const p = withEnv('full', () => buildResolverUserPrompt(big));
    expect(p).toMatch(/\[… 3500 more chars of the workspace delta not shown — /);
  });
  it('planner prompt: default sees 2000 of a TB4-sized orient output silently; full sees all of it', () => {
    const c: any = { task: 't', envReport: '', observations: obs };
    expect(withEnv(undefined, () => buildPlannerUserPrompt(c))).not.toContain('O'.repeat(2001));
    expect(withEnv('full', () => buildPlannerUserPrompt(c))).toContain(obs);
  });
});
