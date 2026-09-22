import { describe, it, expect } from 'vitest';
import {
  PLANNER_SYSTEM,
  PLANNER_SYSTEM_V1,
  DOCTRINE_V2,
  plannerSystem,
  buildPlannerUserPrompt,
  resolveLiftPlanConfig,
  ENV_RECON_COMMAND, parsePlannerResponse, PLANNER_INVESTIGATE_CLAUSE, PLANNER_DECIDE_NOW_CLAUSE } from '../liftPlanner.js';

describe('liftPlanner — resolveLiftPlanConfig', () => {
  it('defaults the output budget to 4000 (max reasoning needs room or the plan is empty)', () => {
    expect(resolveLiftPlanConfig({} as NodeJS.ProcessEnv).outputBudgetTokens).toBe(4000);
  });
  it('defaults the effort to max (bounded planner can safely reason hard)', () => {
    expect(resolveLiftPlanConfig({} as NodeJS.ProcessEnv).effort).toBe('max');
  });
  it('honors a valid CORTEX_LIFT_PLAN_BUDGET_TOKENS override', () => {
    expect(
      resolveLiftPlanConfig({ CORTEX_LIFT_PLAN_BUDGET_TOKENS: '2000' } as any).outputBudgetTokens,
    ).toBe(2000);
  });
  it('honors a CORTEX_LIFT_PLAN_EFFORT override', () => {
    expect(resolveLiftPlanConfig({ CORTEX_LIFT_PLAN_EFFORT: 'medium' } as any).effort).toBe('medium');
  });
  it('defaults reconTimeoutMs to 8000 and honors an override', () => {
    expect(resolveLiftPlanConfig({} as NodeJS.ProcessEnv).reconTimeoutMs).toBe(8000);
    expect(resolveLiftPlanConfig({ CORTEX_LIFT_PLAN_RECON_TIMEOUT_MS: '3000' } as any).reconTimeoutMs).toBe(3000);
  });
  it('falls back to the default budget on a non-positive/garbage value', () => {
    expect(resolveLiftPlanConfig({ CORTEX_LIFT_PLAN_BUDGET_TOKENS: '0' } as any).outputBudgetTokens).toBe(4000);
    expect(resolveLiftPlanConfig({ CORTEX_LIFT_PLAN_BUDGET_TOKENS: 'x' } as any).outputBudgetTokens).toBe(4000);
  });
});

describe('liftPlanner — PLANNER_SYSTEM (the 3-part role)', () => {
  it('directs adversarial analysis, real-criteria confirmation, and plan-or-retire', () => {
    expect(PLANNER_SYSTEM).toMatch(/adversarial/i);
    expect(PLANNER_SYSTEM).toMatch(/criteria/i);
    expect(PLANNER_SYSTEM).toMatch(/grader/i);
    expect(PLANNER_SYSTEM).toMatch(/RETIRE/);
  });
  it('names both measured failure classes (grind + self-graded tests)', () => {
    expect(PLANNER_SYSTEM).toMatch(/grind/i);
    expect(PLANNER_SYSTEM).toMatch(/own tests/i);
  });
  it('steers install (uv) + per-step Bash timeouts from the environment report', () => {
    expect(PLANNER_SYSTEM).toMatch(/ENVIRONMENT REPORT/);
    expect(PLANNER_SYSTEM).toMatch(/uv/);
    expect(PLANNER_SYSTEM).toMatch(/install/i);
    expect(PLANNER_SYSTEM).toMatch(/600000/);
    expect(PLANNER_SYSTEM).toMatch(/timeout/i);
  });
  it('steers ONE install layer — no redundant toolchain stacks (uv owns venv+packages; reuse what is present)', () => {
    expect(PLANNER_SYSTEM).toMatch(/ONE INSTALL LAYER/);
    expect(PLANNER_SYSTEM).toMatch(/uv venv/);
    expect(PLANNER_SYSTEM).toMatch(/Never stack the same capability twice/);
    expect(PLANNER_SYSTEM).toMatch(/reuse whatever the report shows PRESENT/);
  });
  it('steers the census doctrine: no long sleeps, byte-level transforms for exact output, literals verbatim, no baked constants', () => {
    expect(PLANNER_SYSTEM).toMatch(/LONG WAITS/);
    expect(PLANNER_SYSTEM).toMatch(/<= 60 s per wait/);
    expect(PLANNER_SYSTEM).toMatch(/EXACT-OUTPUT/);
    expect(PLANNER_SYSTEM).toMatch(/parse-then-re-serialize/);
    expect(PLANNER_SYSTEM).toMatch(/EXPECTED LITERALS ARE LAW/);
    expect(PLANNER_SYSTEM).toMatch(/re-parameterizes/);
    expect(PLANNER_SYSTEM).toMatch(/never bake constants/);
  });
});

describe('liftPlanner — ENV_RECON_COMMAND', () => {
  it('probes tooling, python packages, resources, and test files', () => {
    expect(ENV_RECON_COMMAND).toMatch(/command -v/);
    expect(ENV_RECON_COMMAND).toMatch(/pip list/);
    expect(ENV_RECON_COMMAND).toMatch(/uv/);
    expect(ENV_RECON_COMMAND).toMatch(/df -h/);
    expect(ENV_RECON_COMMAND).toMatch(/-iname "\*test\*"/);
  });
  it('is fail-soft (redirects stderr, head-bounds output)', () => {
    expect(ENV_RECON_COMMAND).toMatch(/2>\/dev\/null/);
    expect(ENV_RECON_COMMAND).toMatch(/head -/);
  });
});

describe('liftPlanner — buildPlannerUserPrompt', () => {
  it('includes the task and the observations, and a closing directive', () => {
    const out = buildPlannerUserPrompt({ task: 'Build a MIPS interpreter', observations: '$ ls\nrun.py' });
    expect(out).toContain('TASK:');
    expect(out).toContain('Build a MIPS interpreter');
    expect(out).toContain('OBSERVED SO FAR');
    expect(out).toContain('run.py');
    expect(out).toMatch(/numbered plan/i);
  });
  it('omits the observations block when there is none', () => {
    const out = buildPlannerUserPrompt({ task: 'do X', observations: '' });
    expect(out).toContain('TASK:');
    expect(out).not.toContain('OBSERVED SO FAR');
  });
  it('includes the ENVIRONMENT REPORT block when envReport is given, omits it otherwise', () => {
    const withEnv = buildPlannerUserPrompt({ task: 'X', observations: '', envReport: '== TOOLING ==\n  uv=/usr/bin/uv' });
    expect(withEnv).toContain('what is actually on this box'); // the block header
    expect(withEnv).toContain('uv=/usr/bin/uv');
    const noEnv = buildPlannerUserPrompt({ task: 'X', observations: 'y' });
    expect(noEnv).not.toContain('what is actually on this box'); // block omitted (closing line still mentions the report)
  });
  it('bounds long inputs (task ≤8000 — R188: 25 of 64 TB4.0 tasks exceed the old 2000 — observations ≤2000 chars in their slices)', () => {
    const bigTask = 'T'.repeat(9000);
    const bigObs = 'O'.repeat(5000);
    const out = buildPlannerUserPrompt({ task: bigTask, observations: bigObs });
    expect(out).toContain('T'.repeat(8000));
    expect(out).not.toContain('T'.repeat(8001));
    expect(out).toContain('O'.repeat(2000));
    expect(out).not.toContain('O'.repeat(2001));
  });
});

describe('CORTEX_LIFT_PLAN_DOCTRINE (4.107.2 lever)', () => {
  it('v1 is the 4.107.0 prompt: no doctrine bullets; v2 = v1 + DOCTRINE_V2', () => {
    expect(PLANNER_SYSTEM_V1).not.toMatch(/ONE INSTALL LAYER|LONG WAITS|EXACT-OUTPUT|EXPECTED LITERALS ARE LAW/);
    expect(PLANNER_SYSTEM_V1).toMatch(/uv for Python/);
    expect(PLANNER_SYSTEM).toContain(DOCTRINE_V2);
    expect(PLANNER_SYSTEM.replace(DOCTRINE_V2, '')).toBe(PLANNER_SYSTEM_V1);
  });
  it('selector: default/empty/junk → v1; v2 → the bullets', () => {
    expect(plannerSystem({})).toBe(PLANNER_SYSTEM_V1);
    expect(plannerSystem({ CORTEX_LIFT_PLAN_DOCTRINE: '' })).toBe(PLANNER_SYSTEM_V1);
    expect(plannerSystem({ CORTEX_LIFT_PLAN_DOCTRINE: 'v3' })).toBe(PLANNER_SYSTEM_V1);
    expect(plannerSystem({ CORTEX_LIFT_PLAN_DOCTRINE: ' V2 ' })).toBe(PLANNER_SYSTEM);
  });
});


describe('liftPlanner — R171 bounded investigation loop (HB-LIFT-PLAN-TOOL-LOOP)', () => {
  it('config: default 1 round / 240 s; clamped 1..5 and 10 s..30 min', () => {
    const d = resolveLiftPlanConfig({} as any);
    expect(d.toolRounds).toBe(1); expect(d.toolRoundBudgetMs).toBe(240_000);
    expect(resolveLiftPlanConfig({ CORTEX_LIFT_PLAN_TOOL_ROUNDS: '3' } as any).toolRounds).toBe(3);
    expect(resolveLiftPlanConfig({ CORTEX_LIFT_PLAN_TOOL_ROUNDS: '9' } as any).toolRounds).toBe(5);
    expect(resolveLiftPlanConfig({ CORTEX_LIFT_PLAN_TOOL_ROUNDS: '0' } as any).toolRounds).toBe(1);
    expect(resolveLiftPlanConfig({ CORTEX_LIFT_PLAN_TOOL_ROUND_BUDGET_MS: '5000' } as any).toolRoundBudgetMs).toBe(240_000);
  });
  it('persona: INVESTIGATE offered only on request, withdrawn on the last round, absent by default (both doctrines)', () => {
    expect(plannerSystem({} as any)).not.toContain('INVESTIGATE');
    expect(plannerSystem({ CORTEX_LIFT_PLAN_DOCTRINE: 'v2' } as any)).not.toContain('INVESTIGATE');
    expect(plannerSystem({} as any, 'offer')).toContain(PLANNER_INVESTIGATE_CLAUSE);
    expect(plannerSystem({ CORTEX_LIFT_PLAN_DOCTRINE: 'v2' } as any, 'offer')).toContain('ONE INSTALL LAYER');
    expect(plannerSystem({} as any, 'withdraw')).toContain(PLANNER_DECIDE_NOW_CLAUSE);
    expect(plannerSystem({} as any, 'withdraw')).not.toContain(PLANNER_INVESTIGATE_CLAUSE);
  });
  it('parser: INVESTIGATE first line with CHECK/READ lines; a plan is not an investigation; INVESTIGATE mid-text does not count', () => {
    const v = parsePlannerResponse('INVESTIGATE\nCHECK: ls tests/\nREAD: tests/test_main.py:1-60\nREAD: `README.md`\nCHECK: ls tests/\n');
    expect(v.investigate).toBe(true); expect(v.checks).toEqual(['ls tests/']); expect(v.reads).toEqual(['tests/test_main.py:1-60', 'README.md']); expect(v.plan).toBe('');
    const v2 = parsePlannerResponse('VERDICT: INVESTIGATE\n- CHECK: cat Makefile');
    expect(v2.investigate).toBe(true); expect(v2.checks).toEqual(['cat Makefile']);
    const p = parsePlannerResponse('1. Read tests/test_main.py first.\n2. Do not INVESTIGATE further; build.\nCHECK: not-a-request');
    expect(p.investigate).toBe(false); expect(p.plan).toContain('1. Read tests'); expect(p.checks).toEqual([]);
    expect(parsePlannerResponse('').investigate).toBe(false); expect(parsePlannerResponse('').plan).toBe('');
  });
  it('prompt: evidence rounds ride before the closing instruction; offer/withdraw wording; default byte-identical', () => {
    const base = buildPlannerUserPrompt({ task: 'T', observations: 'O' });
    expect(base).toContain('Produce the criteria-anchored numbered plan now'); expect(base).not.toContain('INVESTIGATE');
    const offer = buildPlannerUserPrompt({ task: 'T', observations: 'O', evidenceRounds: ['EVIDENCE (investigation round 1, executed by the harness just now; ground truth):\nCHECK RUN: `ls tests/` → PASSED in 2 ms\ntest_main.py'] }, 'offer');
    expect(offer).toContain('EVIDENCE (investigation round 1'); expect(offer.indexOf('EVIDENCE')).toBeLessThan(offer.indexOf('your first line is `INVESTIGATE`'));
    expect(offer).toContain('READ: <path>');
    const wd = buildPlannerUserPrompt({ task: 'T', observations: 'O' }, 'withdraw');
    expect(wd).toContain('No further investigation is available.'); expect(wd).not.toContain('`INVESTIGATE`');
  });
});
