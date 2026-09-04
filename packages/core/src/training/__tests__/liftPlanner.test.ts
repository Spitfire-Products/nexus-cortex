import { describe, it, expect } from 'vitest';
import {
  PLANNER_SYSTEM,
  buildPlannerUserPrompt,
  resolveLiftPlanConfig,
  ENV_RECON_COMMAND,
} from '../liftPlanner.js';

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
  it('bounds long inputs (task ≤2000, observations ≤2000 chars in their slices)', () => {
    const bigTask = 'T'.repeat(5000);
    const bigObs = 'O'.repeat(5000);
    const out = buildPlannerUserPrompt({ task: bigTask, observations: bigObs });
    expect(out).toContain('T'.repeat(2000));
    expect(out).not.toContain('T'.repeat(2001));
    expect(out).toContain('O'.repeat(2000));
    expect(out).not.toContain('O'.repeat(2001));
  });
});
