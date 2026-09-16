import { describe, it, expect } from 'vitest';
import {
  RESOLVER_SYSTEM,
  resolverSystemPrompt,
  buildResolverUserPrompt,
  resolveEndTurnResolverConfig,
  parseResolverVerdict,
} from '../endTurnResolver.js';

describe('endTurnResolver — resolveEndTurnResolverConfig', () => {
  it('defaults to max/4000 and 2 max-rejects', () => {
    const c = resolveEndTurnResolverConfig({} as NodeJS.ProcessEnv);
    expect(c.outputBudgetTokens).toBe(4000);
    expect(c.effort).toBe('max');
    expect(c.maxRejects).toBe(2);
  });
  it('honors overrides (incl. maxRejects=0)', () => {
    expect(resolveEndTurnResolverConfig({ CORTEX_ENDTURN_RESOLVER_MAX_REJECTS: '0' } as any).maxRejects).toBe(0);
    expect(resolveEndTurnResolverConfig({ CORTEX_ENDTURN_RESOLVER_EFFORT: 'medium' } as any).effort).toBe('medium');
    expect(resolveEndTurnResolverConfig({ CORTEX_ENDTURN_RESOLVER_BUDGET_TOKENS: '2000' } as any).outputBudgetTokens).toBe(2000);
  });
});

describe('endTurnResolver — RESOLVER_SYSTEM (the yes/no judge)', () => {
  it('demands a machine-parseable VERDICT line and a fix plan on GAP', () => {
    expect(RESOLVER_SYSTEM).toMatch(/VERDICT: MEETS/);
    expect(RESOLVER_SYSTEM).toMatch(/VERDICT: GAP/);
    expect(RESOLVER_SYSTEM).toMatch(/fix plan/i);
    expect(RESOLVER_SYSTEM).toMatch(/hidden grader|task's real requirements/i);
    expect(RESOLVER_SYSTEM).toMatch(/own test/i); // anti-self-graded
  });
});

describe('endTurnResolver — buildResolverUserPrompt', () => {
  it('includes task + work product; env + attestation only when given', () => {
    const full = buildResolverUserPrompt({ task: 'do X', envReport: 'tooling: uv', workProduct: 'built Y', attestation: 'req A: done' });
    expect(full).toContain('TASK:');
    expect(full).toContain('do X');
    expect(full).toContain('WORK PRODUCT');
    expect(full).toContain('built Y');
    expect(full).toContain('ENVIRONMENT REPORT');
    expect(full).toContain('ATTESTATION');
    const bare = buildResolverUserPrompt({ task: 'do X', workProduct: 'built Y' });
    expect(bare).not.toContain('ENVIRONMENT REPORT');
    expect(bare).not.toContain('ATTESTATION');
  });
});

describe('endTurnResolver — parseResolverVerdict', () => {
  it('parses MEETS', () => {
    const v = parseResolverVerdict('VERDICT: MEETS\nlooks complete');
    expect(v).toMatchObject({ meets: true, parsed: true, blank: false });
  });
  it('parses GAP and extracts the plan after the verdict line', () => {
    const v = parseResolverVerdict('VERDICT: GAP\n1. add NOT_FOUND handling\n2. rerun make test');
    expect(v.meets).toBe(false);
    expect(v.parsed).toBe(true);
    expect(v.plan).toContain('NOT_FOUND');
  });
  it('fail-opens to MEETS on empty/unparseable text (never traps the junior)', () => {
    // 2026-09-10 (cell-m pilot): a blank/verdict-less judge response is NOT a MEETS — it is `blank` and the
    // orchestrator ABSTAINS (finish accepted, no veto, banked as a judge failure).
    expect(parseResolverVerdict('')).toMatchObject({ meets: false, parsed: false, blank: true });
    expect(parseResolverVerdict('the model rambled with no verdict line')).toMatchObject({ meets: false, parsed: false, blank: true });
  });
  it('is case-insensitive on the verdict token', () => {
    expect(parseResolverVerdict('verdict: gap\nfix it').meets).toBe(false);
  });
  it('MEETS and GAP are never retire', () => {
    expect(parseResolverVerdict('VERDICT: MEETS').retire).toBe(false);
    expect(parseResolverVerdict('VERDICT: GAP\nfix').retire).toBe(false);
  });
});

describe('endTurnResolver — ABSTENTION (RETIRE verdict)', () => {
  it('abstain defaults OFF; honors CORTEX_ENDTURN_RESOLVER_ABSTAIN=true', () => {
    expect(resolveEndTurnResolverConfig({} as NodeJS.ProcessEnv).abstain).toBe(false);
    expect(resolveEndTurnResolverConfig({ CORTEX_ENDTURN_RESOLVER_ABSTAIN: 'true' } as any).abstain).toBe(true);
    expect(resolveEndTurnResolverConfig({ CORTEX_ENDTURN_RESOLVER_ABSTAIN: 'false' } as any).abstain).toBe(false);
  });
  it('resolverSystemPrompt offers RETIRE only when abstain is on (conservative: when in doubt, GAP)', () => {
    expect(resolverSystemPrompt(false)).toBe(RESOLVER_SYSTEM);
    expect(resolverSystemPrompt(false)).not.toMatch(/VERDICT: RETIRE/);
    const on = resolverSystemPrompt(true);
    expect(on).toMatch(/VERDICT: RETIRE/);
    expect(on).toMatch(/when in doubt.*choose GAP/i);
    expect(on).toMatch(/unclosable/i);
  });
  it('buildResolverUserPrompt mentions RETIRE only when abstain is on', () => {
    expect(buildResolverUserPrompt({ task: 't', workProduct: 'w' }, false)).not.toContain('RETIRE');
    expect(buildResolverUserPrompt({ task: 't', workProduct: 'w' }, true)).toContain('RETIRE');
  });
  it('parseResolverVerdict parses RETIRE (not-meets, retire, reason after the line)', () => {
    const v = parseResolverVerdict('VERDICT: RETIRE\nmissing gcc toolchain cannot be installed in this box');
    expect(v.meets).toBe(false);
    expect(v.retire).toBe(true);
    expect(v.parsed).toBe(true);
    expect(v.plan).toContain('gcc toolchain');
  });
  it('RETIRE is case-insensitive', () => {
    expect(parseResolverVerdict('verdict: retire\nhopeless').retire).toBe(true);
  });
});


describe('4.107.0 — the resolver receives the lift plan as an ADVISORY anchor', () => {
  it('includes the PLAN OF ATTACK section only when a plan is given, bounded, before the environment report', () => {
    const base = { task: 'do X', envReport: 'ENV', workProduct: 'WP' };
    expect(buildResolverUserPrompt(base)).not.toContain('PLAN OF ATTACK');
    const p = buildResolverUserPrompt({ ...base, liftPlan: '1. read the grader\n2. ' + 'x'.repeat(5000) });
    expect(p).toContain('PLAN OF ATTACK (stated at lift');
    expect(p).toContain('the TASK wins');
    expect(p.indexOf('PLAN OF ATTACK')).toBeLessThan(p.indexOf('ENVIRONMENT REPORT'));
    expect(p.indexOf('PLAN OF ATTACK')).toBeGreaterThan(p.indexOf('TASK:'));
    expect(p.length).toBeLessThan(3500 + 800);
  });
});

// R160 HB-RESOLVER-BUDGET-CAP (2026-09-16): the reject cap follows the wall budget.
import { effectiveMaxRejects, budgetedVetoEscalation } from '../endTurnResolver.js';
describe('endTurnResolver — R160 budget-aware reject cap', () => {
  const cfg = resolveEndTurnResolverConfig({} as NodeJS.ProcessEnv);
  it('defaults the budgeted cap to 6 and clamps overrides to 0..20', () => {
    expect(cfg.maxRejectsBudgeted).toBe(6);
    expect(resolveEndTurnResolverConfig({ CORTEX_ENDTURN_RESOLVER_MAX_REJECTS_BUDGETED: '0' } as any).maxRejectsBudgeted).toBe(0);
    expect(resolveEndTurnResolverConfig({ CORTEX_ENDTURN_RESOLVER_MAX_REJECTS_BUDGETED: '99' } as any).maxRejectsBudgeted).toBe(20);
  });
  it('uses the budgeted cap while >= minRemaining of the budget is left, the liveness cap otherwise', () => {
    expect(effectiveMaxRejects(cfg, 0.95, 0.5)).toBe(6);
    expect(effectiveMaxRejects(cfg, 0.5, 0.5)).toBe(6);
    expect(effectiveMaxRejects(cfg, 0.49, 0.5)).toBe(2);
    expect(effectiveMaxRejects(cfg, null, 0.5)).toBe(2); // no deadline
    expect(effectiveMaxRejects(cfg, 0.95, 0)).toBe(2); // continue-nudge lever off
    expect(effectiveMaxRejects({ ...cfg, maxRejectsBudgeted: 0 }, 0.95, 0.5)).toBe(2); // disabled → byte-identical
    expect(effectiveMaxRejects({ ...cfg, maxRejectsBudgeted: 1 }, 0.95, 0.5)).toBe(2); // never below the liveness cap
  });
  it('escalation text appears from the second veto and names the remaining budget', () => {
    expect(budgetedVetoEscalation(1, 6, 7 * 3600000, 8 * 3600000)).toBe('');
    const t = budgetedVetoEscalation(2, 6, 7 * 3600000 + 5 * 60000, 8 * 3600000);
    expect(t).toContain('veto 2 of 6');
    expect(t).toContain('7h05m');
    expect(t).toContain('open_items');
    expect(budgetedVetoEscalation(3, 6, 60000, 0)).toBe(''); // no deadline → no escalation
  });
});

// R165 HB-JUDGE-SEMANTIC (2026-09-16): confidence + named checks parsed; the veto policy is a pure table.
import { decideVetoAction, buildResolverUserPrompt as _brp } from '../endTurnResolver.js';
describe('endTurnResolver — R165 semantic judge', () => {
  it('parses CONFIDENCE and CHECK lines out of a GAP plan and strips them from the plan text', () => {
    const v = parseResolverVerdict('VERDICT: GAP\nCONFIDENCE: medium\n1. u exceeds ±500.\nCHECK: `python3 -c "import numpy as np; d=np.load(\'/app/results/run.npz\'); assert abs(d[\'u\']).max()<=500"`\n2. dt spacing.\n   CHECK: python3 /app/check_dt.py\n');
    expect(v.meets).toBe(false); expect(v.confidence).toBe('medium');
    expect(v.checks).toEqual(['python3 -c "import numpy as np; d=np.load(\'/app/results/run.npz\'); assert abs(d[\'u\']).max()<=500"', 'python3 /app/check_dt.py']);
    expect(v.plan.startsWith('1. u exceeds')).toBe(true);
    expect(v.plan).not.toMatch(/CONFIDENCE:/);
  });
  it('defaults confidence to high and checks to [] for the old format', () => {
    const v = parseResolverVerdict('VERDICT: GAP\n1. missing file');
    expect(v.confidence).toBe('high'); expect(v.checks).toEqual([]);
    expect(parseResolverVerdict('VERDICT: MEETS').confidence).toBe('high');
  });
  it('config levers: semantic on, 3 progress calls, escalation on; all overridable', () => {
    const c = resolveEndTurnResolverConfig({} as any);
    expect(c.semantic).toBe(true); expect(c.progressMinCalls).toBe(3); expect(c.escalateReasoning).toBe(true);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_SEMANTIC: 'false' } as any).semantic).toBe(false);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_PROGRESS_MIN_CALLS: '7' } as any).progressMinCalls).toBe(7);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_ESCALATE_REASONING: 'off' } as any).escalateReasoning).toBe(false);
  });
  it('veto policy: first GAP vetoes; progress keeps vetoing under the cap; no progress escalates once then accepts-with-gap; low confidence without a failed check never vetoes', () => {
    const base = { meets: false, blank: false, retire: false, confidence: 'high' as const, cap: 6, checksFailed: false };
    expect(decideVetoAction({ ...base, rejects: 0, progressed: false, escalated: false })).toBe('veto');
    expect(decideVetoAction({ ...base, rejects: 2, progressed: true, escalated: false })).toBe('veto');
    expect(decideVetoAction({ ...base, rejects: 2, progressed: false, escalated: false })).toBe('escalate');
    expect(decideVetoAction({ ...base, rejects: 2, progressed: false, escalated: true })).toBe('accept-with-gap');
    expect(decideVetoAction({ ...base, rejects: 6, progressed: true, escalated: false })).toBe('accept-with-gap');
    expect(decideVetoAction({ ...base, confidence: 'low', rejects: 0, progressed: false, escalated: false })).toBe('accept-low-confidence');
    expect(decideVetoAction({ ...base, confidence: 'low', checksFailed: true, rejects: 0, progressed: false, escalated: false })).toBe('veto');
    expect(decideVetoAction({ ...base, meets: true, rejects: 0, progressed: false, escalated: false })).toBe('accept');
    expect(decideVetoAction({ ...base, blank: true, rejects: 0, progressed: false, escalated: false })).toBe('accept');
  });
  it('the prompt carries prior veto items and progress, and the persona asks for CONFIDENCE and CHECK lines', () => {
    const p = _brp({ task: 'do x', workProduct: 'done', priorVetoItems: '1. u exceeds 500', progressSummary: '12 tool calls; ran named check 1' });
    expect(p).toContain('PRIOR VETO ITEMS'); expect(p).toContain('PROGRESS SINCE THAT VETO');
    expect(RESOLVER_SYSTEM).toMatch(/CONFIDENCE: high/); expect(RESOLVER_SYSTEM).toMatch(/CHECK: <command>/);
  });
});
