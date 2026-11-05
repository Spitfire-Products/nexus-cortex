import { describe, it, expect } from 'vitest';
import { taskScope, unscopedEvidence, scopeCheck, scopeCheckEnabled } from '../scopeCheck.js';

describe('scope check (CORTEX_SCOPE_CHECK, 2026-11-04)', () => {
  it('extracts place / radius scope and ignores amounts, counts and ids', () => {
    expect(taskScope('Find Nissan and Honda cars for sale near Kentwood, MI 49512.').places).toEqual(expect.arrayContaining(['49512', 'Kentwood, MI']));
    expect(taskScope('best-rated accredited charity near 12023. When done, report it').places).toEqual(['12023']);
    expect(taskScope('dermatologists within 10 miles of zip 10019').radius).toBe('10 miles');
    expect(taskScope('a 15,000-dollar car with 48 months').places).toEqual([]);
    expect(taskScope('track shipment #30238 and report status').places).toEqual([]);
    expect(taskScope('refactor src/app.ts so tests pass in under 20 seconds').places).toEqual([]);
  });
  it('flags a SELECTED nationwide choice, not the bare word', () => {
    expect(unscopedEvidence(['{"distance":{"displayValue":"Nationwide","isSelected":true}}'])?.kind).toBe('marker');
    expect(unscopedEvidence(['{"title":"Used Vehicles for Sale Nationwide | Cars.com"}'])).toBeNull();
  });
  it('the newest scoped state wins over an older nationwide count', () => {
    expect(unscopedEvidence(['"44 of 14,610 results"', 'https://x.com/cars?zip=49512&radius=75 showing 22 matches'])).toBeNull();
    expect(unscopedEvidence(['https://x.com/cars?radius=75', '"44 of 14,610 results" Nationwide selected'])?.kind).toBe('marker');
  });
  it('judges only the main count when one is named, and skips counts the text calls site-wide', () => {
    expect(unscopedEvidence(['{"mainCount":{"text":"22 matches"},"otherCounts":["89,775 matches"]}'])).toBeNull();
    expect(unscopedEvidence(['{"mainCount":{"text":"44 of 14,579 results"}}'])?.kind).toBe('count');
    expect(unscopedEvidence(['the carousel header "89,775 matches" is the site-wide unfiltered total'])).toBeNull();
  });
  it('holds once on a place-scoped task with unscoped results; inert otherwise', () => {
    const task = 'Show Honda and Nissan cars near Kentwood, MI 49512';
    const v = scopeCheck({ taskText: task, latestOutputs: ['"44 of 14,579 results"'], alreadyHeld: false });
    expect(v.ok).toBe(false); expect(v.nudge).toContain('scope check');
    expect(scopeCheck({ taskText: task, latestOutputs: ['"44 of 14,579 results"'], alreadyHeld: true }).ok).toBe(true);
    expect(scopeCheck({ taskText: 'Fix the failing test in src/', latestOutputs: ['14,579 results'], alreadyHeld: false }).ok).toBe(true);
  });
  it('defaults on; off|false|0 disables', () => {
    expect(scopeCheckEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    for (const v of ['off', 'false', '0']) expect(scopeCheckEnabled({ CORTEX_SCOPE_CHECK: v } as NodeJS.ProcessEnv)).toBe(false);
  });
});
