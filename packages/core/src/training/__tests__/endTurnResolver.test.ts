import { describe, it, expect } from 'vitest';
import {
  RESOLVER_SYSTEM,
  resolverSystemPrompt,
  buildResolverUserPrompt,
  resolveEndTurnResolverConfig,
  parseResolverVerdict,
  gapHoldable, buildSpecTestsPrompt, SPEC_TESTS_SYSTEM, parseSpecChecks, applyVetoFloor, holdProgressed, planSimilarity, specCheckEvidence,
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
import { decideVetoAction, buildResolverUserPrompt as _brp, shouldFinishConfirm, buildFinishConfirmMessage, buildMeetsConfirmMessage, resolverSystemPrompt as rsp, RESOLVER_MEETS_CHECK_LINE, RESOLVER_MEETS_DEFAULT_LINE, RESOLVER_INVESTIGATE_CLAUSE, RESOLVER_DECIDE_NOW_CLAUSE, buildResolverUserPrompt as brp2 } from '../endTurnResolver.js';
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
  it('veto policy (opinion mode, the R165 table; R166 makes evidence the default): first GAP vetoes; progress keeps vetoing under the cap; no progress escalates once then accepts-with-gap; low confidence without a failed check never vetoes', () => {
    const base = { meets: false, blank: false, retire: false, confidence: 'high' as const, cap: 6, checksFailed: false, vetoMode: 'opinion' as const };
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

describe('endTurnResolver — R166 evidence-gated veto (HB-JUDGE-EVIDENCE-VETO)', () => {
  const base = { meets: false, blank: false, retire: false, confidence: 'high' as const, cap: 6, checksFailed: false, progressed: true, escalated: false };
  it('config: default evidence mode with 1 veto; opinion/never selectable; cap clamped 0..20', () => {
    const d = resolveEndTurnResolverConfig({} as any);
    expect(d.vetoMode).toBe('evidence'); expect(d.evidenceCap).toBe(1);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_VETO: 'opinion' } as any).vetoMode).toBe('opinion');
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_VETO: 'NEVER' } as any).vetoMode).toBe('never');
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_VETO: 'bogus' } as any).vetoMode).toBe('evidence');
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_EVIDENCE_MAX_VETOES: '3' } as any).evidenceCap).toBe(3);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_EVIDENCE_MAX_VETOES: '99' } as any).evidenceCap).toBe(20);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_EVIDENCE_MAX_VETOES: '-1' } as any).evidenceCap).toBe(1);
  });
  it('evidence mode (default): a GAP without a failed harness-run check never holds the finish', () => {
    expect(decideVetoAction({ ...base, rejects: 0 })).toBe('accept-with-gap');
    expect(decideVetoAction({ ...base, rejects: 0, confidence: 'medium' })).toBe('accept-with-gap');
    expect(decideVetoAction({ ...base, rejects: 0, progressed: false })).toBe('accept-with-gap'); // never escalates on opinion
  });
  it('evidence mode: a failed check holds the finish once, then the finish stands', () => {
    expect(decideVetoAction({ ...base, rejects: 0, checksFailed: true })).toBe('veto');
    expect(decideVetoAction({ ...base, rejects: 1, checksFailed: true })).toBe('accept-with-gap');
    expect(decideVetoAction({ ...base, rejects: 1, checksFailed: true, evidenceCap: 2 })).toBe('veto');
    expect(decideVetoAction({ ...base, rejects: 2, checksFailed: true, evidenceCap: 2 })).toBe('accept-with-gap');
    expect(decideVetoAction({ ...base, rejects: 0, checksFailed: true, evidenceCap: 0 })).toBe('accept-with-gap');
    expect(decideVetoAction({ ...base, rejects: 3, cap: 3, checksFailed: true, evidenceCap: 5 })).toBe('accept-with-gap'); // budget cap still binds
  });
  it('evidence mode: low confidence with a failed check still vetoes once (evidence beats confidence)', () => {
    expect(decideVetoAction({ ...base, rejects: 0, confidence: 'low', checksFailed: true })).toBe('veto');
  });
  it('MEETS / blank / retire accept in every mode', () => {
    for (const vetoMode of ['evidence', 'opinion', 'never'] as const) {
      expect(decideVetoAction({ ...base, rejects: 0, meets: true, vetoMode })).toBe('accept');
      expect(decideVetoAction({ ...base, rejects: 0, blank: true, vetoMode })).toBe('accept');
      expect(decideVetoAction({ ...base, rejects: 0, retire: true, vetoMode })).toBe('accept');
    }
  });
  it('never mode records only', () => {
    expect(decideVetoAction({ ...base, rejects: 0, checksFailed: true, vetoMode: 'never' })).toBe('accept-with-gap');
  });
  it('opinion mode is the R165 policy unchanged', () => {
    expect(decideVetoAction({ ...base, rejects: 0, vetoMode: 'opinion' })).toBe('veto');
    expect(decideVetoAction({ ...base, rejects: 2, progressed: false, vetoMode: 'opinion' })).toBe('escalate');
    expect(decideVetoAction({ ...base, rejects: 6, vetoMode: 'opinion' })).toBe('accept-with-gap');
  });
});

describe('endTurnResolver — R167 informed finish confirmation (HB-FINISH-CONFIRM)', () => {
  const cfg = { finishConfirm: true, finishConfirmMinRemaining: 0.3, finishConfirmMax: 1 };
  it('config: default on, floor 0.3, max 1; overridable; clamped', () => {
    const d = resolveEndTurnResolverConfig({} as any);
    expect(d.finishConfirm).toBe(true); expect(d.finishConfirmMinRemaining).toBe(0.3); expect(d.finishConfirmMax).toBe(1);
    expect(resolveEndTurnResolverConfig({ CORTEX_FINISH_CONFIRM: 'false' } as any).finishConfirm).toBe(false);
    expect(resolveEndTurnResolverConfig({ CORTEX_FINISH_CONFIRM_MIN_REMAINING: '0.5' } as any).finishConfirmMinRemaining).toBe(0.5);
    expect(resolveEndTurnResolverConfig({ CORTEX_FINISH_CONFIRM_MIN_REMAINING: '7' } as any).finishConfirmMinRemaining).toBe(0.3);
    expect(resolveEndTurnResolverConfig({ CORTEX_FINISH_CONFIRM_MAX: '9' } as any).finishConfirmMax).toBe(5);
  });
  it('fires only on an accept-with-gap / accept-low-confidence with budget left and confirmations remaining', () => {
    expect(shouldFinishConfirm({ action: 'accept-with-gap', remainingFrac: 0.73, confirmsUsed: 0, cfg })).toBe(true);
    expect(shouldFinishConfirm({ action: 'accept-low-confidence', remainingFrac: 0.31, confirmsUsed: 0, cfg })).toBe(true);
    expect(shouldFinishConfirm({ action: 'accept-with-gap', remainingFrac: 0.29, confirmsUsed: 0, cfg })).toBe(false); // near end of budget: let it finish
    expect(shouldFinishConfirm({ action: 'accept-with-gap', remainingFrac: 0.9, confirmsUsed: 1, cfg })).toBe(false); // already confirmed once
    expect(shouldFinishConfirm({ action: 'accept', remainingFrac: 0.9, confirmsUsed: 0, cfg })).toBe(false); // MEETS stands
    expect(shouldFinishConfirm({ action: 'veto', remainingFrac: 0.9, confirmsUsed: 0, cfg })).toBe(false);
    expect(shouldFinishConfirm({ action: 'accept-with-gap', remainingFrac: null, confirmsUsed: 0, cfg })).toBe(false); // no deadline
    expect(shouldFinishConfirm({ action: 'accept-with-gap', remainingFrac: 0.9, confirmsUsed: 0, cfg: { ...cfg, finishConfirm: false } })).toBe(false);
  });
  it('message carries budget, the reviewer plan and the own open items, and names the consequence', () => {
    const m = buildFinishConfirmMessage({ remainingFrac: 0.73, remainingMs: 65 * 60000, gapPlan: '1. target_theorem is still Admitted', openItems: ['Admitted remains in Main.v'], confidence: 'high' });
    expect(m).toContain('73%'); expect(m).toContain('1h05'); expect(m).toContain('graded as-is');
    expect(m).toContain("REVIEWER'S NOTES (high"); expect(m).toContain('still Admitted');
    expect(m).toContain('YOUR OWN OPEN ITEMS'); expect(m).toContain('Admitted remains');
    expect(m).toContain('call EndTurn again');
    const m2 = buildFinishConfirmMessage({ remainingFrac: 0.4, remainingMs: 20 * 60000, gapPlan: '', openItems: undefined });
    expect(m2).not.toContain('REVIEWER'); expect(m2).not.toContain('OWN OPEN ITEMS'); expect(m2).toContain('20 min');
  });
});

describe('endTurnResolver — R168 verified MEETS (HB-MEETS-CONFIRM)', () => {
  const cfg = { finishConfirm: true, finishConfirmMinRemaining: 0.3, finishConfirmMax: 1, meetsConfirm: true, meetsConfirmMinRemaining: 0.5 };
  it('config: default on, floor 0.5; overridable; clamped', () => {
    const d = resolveEndTurnResolverConfig({} as any);
    expect(d.meetsConfirm).toBe(true); expect(d.meetsConfirmMinRemaining).toBe(0.5);
    expect(resolveEndTurnResolverConfig({ CORTEX_MEETS_CONFIRM: 'false' } as any).meetsConfirm).toBe(false);
    expect(resolveEndTurnResolverConfig({ CORTEX_MEETS_CONFIRM_MIN_REMAINING: '0.8' } as any).meetsConfirmMinRemaining).toBe(0.8);
    expect(resolveEndTurnResolverConfig({ CORTEX_MEETS_CONFIRM_MIN_REMAINING: '3' } as any).meetsConfirmMinRemaining).toBe(0.5);
  });
  it('persona: the MEETS line demands proving checks only when the lever is on; abstain clause still composes', () => {
    expect(rsp(false, false)).toContain(RESOLVER_MEETS_DEFAULT_LINE); expect(rsp(false, false)).not.toContain('whose PASSING');
    expect(rsp(false, true)).toContain(RESOLVER_MEETS_CHECK_LINE); expect(rsp(false, true)).not.toContain(RESOLVER_MEETS_DEFAULT_LINE);
    expect(rsp(true, true)).toContain('VERDICT: RETIRE'); expect(rsp(true, true)).toContain(RESOLVER_MEETS_CHECK_LINE);
    expect(rsp(false, true).length).toBeGreaterThan(rsp(false, false).length);
  });
  it('parser: a MEETS with CHECK lines carries them (unchanged behaviour, now load-bearing)', () => {
    const v = parseResolverVerdict('VERDICT: MEETS\nCONFIDENCE: high\nCHECK: test -f out/report.csv\nCHECK: `python3 -m pytest -q tests/`\n');
    expect(v.meets).toBe(true); expect(v.checks).toEqual(['test -f out/report.csv', 'python3 -m pytest -q tests/']);
  });
  it('hold: an unverified MEETS with budget left is held once; a verified one stands; lever off = 4.116.2', () => {
    expect(shouldFinishConfirm({ action: 'accept', meets: true, evidencePassed: false, remainingFrac: 0.85, confirmsUsed: 0, cfg })).toBe(true);
    expect(shouldFinishConfirm({ action: 'accept', meets: true, evidencePassed: true, remainingFrac: 0.85, confirmsUsed: 0, cfg })).toBe(false); // proven
    expect(shouldFinishConfirm({ action: 'accept', meets: true, evidencePassed: false, remainingFrac: 0.49, confirmsUsed: 0, cfg })).toBe(false); // below the floor
    expect(shouldFinishConfirm({ action: 'accept', meets: true, evidencePassed: false, remainingFrac: 0.85, confirmsUsed: 1, cfg })).toBe(false); // shared counter spent
    expect(shouldFinishConfirm({ action: 'accept', meets: true, evidencePassed: false, remainingFrac: null, confirmsUsed: 0, cfg })).toBe(false); // no deadline
    expect(shouldFinishConfirm({ action: 'accept', meets: true, evidencePassed: false, remainingFrac: 0.85, confirmsUsed: 0, cfg: { ...cfg, meetsConfirm: false } })).toBe(false);
    expect(shouldFinishConfirm({ action: 'accept', remainingFrac: 0.9, confirmsUsed: 0, cfg })).toBe(false); // no meets flag = blank/retire accepts stand
    expect(shouldFinishConfirm({ action: 'accept-with-gap', remainingFrac: 0.73, confirmsUsed: 0, cfg })).toBe(true); // R167 untouched
    expect(shouldFinishConfirm({ action: 'accept-with-gap', remainingFrac: 0.73, confirmsUsed: 0, cfg: { ...cfg, finishConfirm: false } })).toBe(false);
  });
  it('message: names the missing evidence, shows failed checks, budget, own items, and the consequence', () => {
    const m0 = buildMeetsConfirmMessage({ remainingFrac: 0.88, remainingMs: 79 * 60000, checksNamed: 0, checkResults: '', openItems: ['edge case NOT_FOUND untested'] });
    expect(m0).toContain('UNVERIFIED'); expect(m0).toContain('named NO command'); expect(m0).toContain('88%'); expect(m0).toContain('1h19');
    expect(m0).toContain('YOUR OWN OPEN ITEMS'); expect(m0).toContain('NOT_FOUND'); expect(m0).toContain('call EndTurn again');
    const m1 = buildMeetsConfirmMessage({ remainingFrac: 0.6, remainingMs: 30 * 60000, checksNamed: 2, checkResults: 'CHECK RUN: `test -f out.csv` → FAILED (exit 1) in 12 ms\n(no output)', openItems: undefined });
    expect(m1).toContain('none of the 2 proving check(s)'); expect(m1).toContain('FAILED (exit 1)'); expect(m1).not.toContain('OWN OPEN ITEMS'); expect(m1).toContain('30 min');
  });
});

describe('endTurnResolver — R170 bounded investigation loop (HB-JUDGE-TOOL-LOOP)', () => {
  it('config: default 1 round / 240 s; clamped 1..5 and 10 s..30 min', () => {
    const d = resolveEndTurnResolverConfig({} as any);
    expect(d.toolRounds).toBe(1); expect(d.toolRoundBudgetMs).toBe(240_000);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_TOOL_ROUNDS: '3' } as any).toolRounds).toBe(3);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_TOOL_ROUNDS: '9' } as any).toolRounds).toBe(5);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_TOOL_ROUNDS: '0' } as any).toolRounds).toBe(1);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_TOOL_ROUND_BUDGET_MS: '5000' } as any).toolRoundBudgetMs).toBe(240_000);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_TOOL_ROUND_BUDGET_MS: '600000' } as any).toolRoundBudgetMs).toBe(600_000);
  });
  it('persona: INVESTIGATE offered only on request, withdrawn on the last round, absent by default', () => {
    expect(rsp(false, false)).not.toContain('VERDICT: INVESTIGATE'); expect(rsp(false, true)).not.toContain('INVESTIGATE');
    expect(rsp(false, true, 'offer')).toContain(RESOLVER_INVESTIGATE_CLAUSE); expect(rsp(true, true, 'offer')).toContain('VERDICT: RETIRE');
    expect(rsp(false, false, 'withdraw')).toContain(RESOLVER_DECIDE_NOW_CLAUSE); expect(rsp(false, false, 'withdraw')).not.toContain(RESOLVER_INVESTIGATE_CLAUSE);
  });
  it('parser: INVESTIGATE with CHECK and READ lines; reads deduped and capped; plain verdicts carry investigate=false', () => {
    const v = parseResolverVerdict('VERDICT: INVESTIGATE\nCONFIDENCE: low\nCHECK: ls -la out/\nREAD: src/main.py:1-40\nREAD: `README.md`\nREAD: src/main.py:1-40\n- READ: a\n2. READ: b\nREAD: c\n');
    expect(v.investigate).toBe(true); expect(v.meets).toBe(false); expect(v.blank).toBe(false); expect(v.parsed).toBe(true);
    expect(v.checks).toEqual(['ls -la out/']); expect(v.reads).toEqual(['src/main.py:1-40', 'README.md', 'a', 'b']);
    const g = parseResolverVerdict('VERDICT: GAP\nCONFIDENCE: high\n1. missing file\nCHECK: test -f x');
    expect(g.investigate).toBe(false); expect(g.reads).toEqual([]); expect(g.checks).toEqual(['test -f x']);
    expect(parseResolverVerdict('').investigate).toBe(false);
  });
  it('prompt: evidence rounds ride between progress and the closing instruction, bounded', () => {
    const p = brp2({ task: 'T', workProduct: 'W', evidenceRounds: ['EVIDENCE (investigation round 1, executed by the harness just now; ground truth):\nCHECK RUN: `ls` → PASSED in 3 ms\nout'] });
    expect(p).toContain('EVIDENCE (investigation round 1'); expect(p.indexOf('EVIDENCE')).toBeLessThan(p.indexOf('Adjudicate now'));
    expect(brp2({ task: 'T', workProduct: 'W' })).not.toContain('EVIDENCE');
  });
});

describe('endTurnResolver — R170 fix (4.117.1): the closing instruction offers INVESTIGATE when the persona does', () => {
  it('offer: INVESTIGATE named first, with CHECK/READ syntax; withdraw: decide-now; default: byte-identical MEETS/GAP line', () => {
    const offer = brp2({ task: 'T', workProduct: 'W' }, false, true, 'offer');
    expect(offer).toContain('VERDICT: INVESTIGATE'); expect(offer).toContain('READ: <path>'); expect(offer).toContain('CHECK: <read-only command>'); expect(offer).toContain('proves'); expect(offer).not.toContain('Adjudicate now.');
    const withdraw = brp2({ task: 'T', workProduct: 'W' }, false, false, 'withdraw');
    expect(withdraw).toContain('No further investigation'); expect(withdraw).not.toContain('INVESTIGATE`');
    const plain = brp2({ task: 'T', workProduct: 'W' });
    expect(plain).toContain('Adjudicate now. First line: `VERDICT: MEETS` or `VERDICT: GAP`. If GAP, add the numbered fix plan anchored to the TASK\'s real criteria.');
    expect(plain).not.toContain('INVESTIGATE'); expect(plain).not.toContain('proves the task');
    const abst = brp2({ task: 'T', workProduct: 'W' }, true, true);
    expect(abst).toContain('`VERDICT: RETIRE`'); expect(abst).toContain('unclosable'); expect(abst).toContain('proves the task');
  });
});

describe('endTurnResolver — R170b auto-loop lever', () => {
  it('config: off by default; true/1/on enables', () => {
    expect(resolveEndTurnResolverConfig({} as any).toolAutoLoop).toBe(false);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_TOOL_AUTOLOOP: 'true' } as any).toolAutoLoop).toBe(true);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_TOOL_AUTOLOOP: 'false' } as any).toolAutoLoop).toBe(false);
  });
});

describe('endTurnResolver — R173 budget-aware gap hold (HB-GAP-HOLD)', () => {
  const base = { meets: false, blank: false, retire: false, confidence: 'high' as const, cap: 6, checksFailed: false, progressed: true, escalated: false };
  it('config: off by default; on/true/1; jev off|shadow|gate with a 0.3 floor', () => {
    const d = resolveEndTurnResolverConfig({} as any);
    expect(d.gapHold).toBe(false); expect(d.gapHoldJev).toBe('off'); expect(d.gapHoldJevMin).toBe(0.3);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_GAP_HOLD: 'true' } as any).gapHold).toBe(true);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_GAP_HOLD_JEV: 'gate', CORTEX_JUDGE_GAP_HOLD_JEV_MIN: '0.5' } as any)).toMatchObject({ gapHoldJev: 'gate', gapHoldJevMin: 0.5 });
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_GAP_HOLD_JEV: 'bogus', CORTEX_JUDGE_GAP_HOLD_JEV_MIN: '7' } as any)).toMatchObject({ gapHoldJev: 'off', gapHoldJevMin: 0.3 });
  });
  it('gapHoldable: needs the lever, a live deadline above the floor, and named items', () => {
    expect(gapHoldable({ gapHold: false, remainingFrac: 0.9, minRemaining: 0.5, planChars: 200 })).toBe(false);
    expect(gapHoldable({ gapHold: true, remainingFrac: null, minRemaining: 0.5, planChars: 200 })).toBe(false); // no deadline → R166 unchanged
    expect(gapHoldable({ gapHold: true, remainingFrac: 0.4, minRemaining: 0.5, planChars: 200 })).toBe(false); // below the floor
    expect(gapHoldable({ gapHold: true, remainingFrac: 0.9, minRemaining: 0, planChars: 200 })).toBe(false); // floor disabled
    expect(gapHoldable({ gapHold: true, remainingFrac: 0.9, minRemaining: 0.5, planChars: 5 })).toBe(false); // nothing named
    expect(gapHoldable({ gapHold: true, remainingFrac: 0.9, minRemaining: 0.5, planChars: 200 })).toBe(true);
  });
  it('gapHoldable: the Jev gate holds only at/above the floor and fails closed when unavailable; shadow never changes the decision', () => {
    const ok = { gapHold: true, remainingFrac: 0.9, minRemaining: 0.5, planChars: 200 };
    expect(gapHoldable({ ...ok, jevMode: 'gate', jevFixable: 0.31, jevMin: 0.3 })).toBe(true);
    expect(gapHoldable({ ...ok, jevMode: 'gate', jevFixable: 0.2, jevMin: 0.3 })).toBe(false);
    expect(gapHoldable({ ...ok, jevMode: 'gate', jevFixable: null })).toBe(false);
    expect(gapHoldable({ ...ok, jevMode: 'shadow', jevFixable: 0.01 })).toBe(true);
  });
  it('decideVetoAction: a holdable GAP vetoes without a failed check, under the R165 progress rules and the budgeted cap', () => {
    expect(decideVetoAction({ ...base, rejects: 0, gapHoldable: true })).toBe('veto');
    expect(decideVetoAction({ ...base, rejects: 1, gapHoldable: true })).toBe('veto'); // past the evidence cap of 1 — the hold does not count vetoes by evidence
    expect(decideVetoAction({ ...base, rejects: 2, progressed: false, gapHoldable: true })).toBe('escalate');
    expect(decideVetoAction({ ...base, rejects: 2, progressed: false, escalated: true, gapHoldable: true })).toBe('accept-with-gap');
    expect(decideVetoAction({ ...base, rejects: 6, gapHoldable: true })).toBe('accept-with-gap'); // budgeted cap binds
    expect(decideVetoAction({ ...base, rejects: 0, gapHoldable: false })).toBe('accept-with-gap'); // R166 unchanged when not holdable
    expect(decideVetoAction({ ...base, rejects: 0, meets: true, gapHoldable: true })).toBe('accept');
  });
});

describe('endTurnResolver — R174 blind spec-derived tests (HB-SPEC-TESTS)', () => {
  it('config: off by default; max 4, clamped 1..8', () => {
    const d = resolveEndTurnResolverConfig({} as any);
    expect(d.specTests).toBe(false); expect(d.specTestsMax).toBe(4);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_SPEC_TESTS: 'true', CORTEX_JUDGE_SPEC_TESTS_MAX: '6' } as any)).toMatchObject({ specTests: true, specTestsMax: 6 });
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_SPEC_TESTS_MAX: '40' } as any).specTestsMax).toBe(8);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_SPEC_TESTS_MAX: '0' } as any).specTestsMax).toBe(4);
  });
  it('the author sees only the task + environment, never the work product', () => {
    const p = buildSpecTestsPrompt('Write /app/out.csv with 3 columns', 'ENV: python3 3.11, /app/data present', 3);
    expect(p).toContain('TASK:'); expect(p).toContain('/app/out.csv'); expect(p).toContain('ENVIRONMENT REPORT'); expect(p).toContain('at most 3 CHECK lines');
    expect(SPEC_TESTS_SYSTEM).toContain('BEFORE any solution exists'); expect(SPEC_TESTS_SYSTEM).toContain('read-only');
    expect(p).not.toMatch(/WORK PRODUCT|ATTESTATION/);
  });
  it('parseSpecChecks: CHECK lines only, backticks stripped, deduped, capped, list prefixes tolerated', () => {
    const txt = 'Here are checks:\nCHECK: test -f /app/out.csv || { echo MISSING; exit 1; }\n- CHECK: `head -1 /app/out.csv | grep -q "a,b,c" || { echo BAD HEADER; exit 1; }`\n2. check: python3 -c "import x" || exit 1\nCHECK: test -f /app/out.csv || { echo MISSING; exit 1; }\nnot a check\nCHECK: ls\nCHECK: pwd\n';
    const c = parseSpecChecks(txt, 4);
    expect(c).toEqual(['test -f /app/out.csv || { echo MISSING; exit 1; }', 'head -1 /app/out.csv | grep -q "a,b,c" || { echo BAD HEADER; exit 1; }', 'python3 -c "import x" || exit 1', 'ls']);
    expect(parseSpecChecks('VERDICT: MEETS\nno checks here')).toEqual([]);
    expect(parseSpecChecks('CHECK: ' + 'x'.repeat(500))).toEqual([]);
  });
});

describe('endTurnResolver — R173c budget floor + hold progress, R174b spec repeat suppression (cell g1 attribution)', () => {
  it('config: floor 0 (off), 3-min interval, 0.6 similarity, repeat max 2, spec at finish; overridable + clamped', () => {
    const d = resolveEndTurnResolverConfig({} as any);
    expect(d.vetoMinRemaining).toBe(0); expect(d.gapHoldMinIntervalMs).toBe(180_000); expect(d.gapHoldPlanMaxSimilarity).toBe(0.6); expect(d.specRepeatMax).toBe(2); expect(d.specTestsAt).toBe('finish');
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_VETO_MIN_REMAINING: '0.25', CORTEX_JUDGE_GAP_HOLD_MIN_INTERVAL_MS: '60000', CORTEX_JUDGE_GAP_HOLD_PLAN_MAX_SIMILARITY: '0.5', CORTEX_JUDGE_SPEC_REPEAT_MAX: '3', CORTEX_JUDGE_SPEC_TESTS_AT: 'lift' } as any))
      .toMatchObject({ vetoMinRemaining: 0.25, gapHoldMinIntervalMs: 60_000, gapHoldPlanMaxSimilarity: 0.5, specRepeatMax: 3, specTestsAt: 'lift' });
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_VETO_MIN_REMAINING: '2', CORTEX_JUDGE_SPEC_REPEAT_MAX: '0', CORTEX_JUDGE_SPEC_TESTS_AT: 'bogus' } as any)).toMatchObject({ vetoMinRemaining: 0, specRepeatMax: 2, specTestsAt: 'finish' });
  });
  it('applyVetoFloor: below the floor a veto/escalate becomes accept-with-gap; accepts and MEETS untouched; off when 0 or no deadline', () => {
    expect(applyVetoFloor('veto', 0.15, 0.25)).toBe('accept-with-gap');
    expect(applyVetoFloor('escalate', 0.2, 0.25)).toBe('accept-with-gap');
    expect(applyVetoFloor('veto', 0.3, 0.25)).toBe('veto');
    expect(applyVetoFloor('accept', 0.1, 0.25)).toBe('accept');
    expect(applyVetoFloor('veto', 0.1, 0)).toBe('veto');
    expect(applyVetoFloor('veto', null, 0.25)).toBe('veto');
  });
  it('holdProgressed: first hold always; a re-hold needs the elapsed time AND a changed plan (R173c-b: a rewritten plan alone is not progress)', () => {
    const plan = '1. write /app/out.csv with header a,b,c\n2. run the checker script';
    const changed = '1. the NMD-escaping variant position is off by one; recompute from the CDS join';
    expect(holdProgressed({ rejects: 0, msSinceLastHold: 0, priorPlan: '', plan, minIntervalMs: 180_000, maxSimilarity: 0.6 })).toBe(true);
    expect(holdProgressed({ rejects: 1, msSinceLastHold: 40_000, priorPlan: plan, plan, minIntervalMs: 180_000, maxSimilarity: 0.6 })).toBe(false); // same items, 40 s later
    expect(holdProgressed({ rejects: 1, msSinceLastHold: 200_000, priorPlan: plan, plan, minIntervalMs: 180_000, maxSimilarity: 0.6 })).toBe(false); // time passed, same items → R165 path
    expect(holdProgressed({ rejects: 1, msSinceLastHold: 200_000, priorPlan: plan, plan: changed, minIntervalMs: 180_000, maxSimilarity: 0.6 })).toBe(true);
    expect(holdProgressed({ rejects: 2, msSinceLastHold: 10_000, priorPlan: plan, plan: changed, minIntervalMs: 180_000, maxSimilarity: 0.6 })).toBe(false); // the g2 production-planning shape: rewritten plan 45–137 s later
    expect(holdProgressed({ rejects: 2, msSinceLastHold: null, priorPlan: plan, plan: changed, minIntervalMs: 180_000, maxSimilarity: 0.6 })).toBe(true); // time unknown → the plan decides
    expect(planSimilarity(plan, plan)).toBe(1); expect(planSimilarity('', '')).toBe(1); expect(planSimilarity('abc def', 'xyz')).toBe(0);
  });
  it('specCheckEvidence: identical repeated failures become suspect at the repeat max unless another check failed; a pass or a different failure resets', () => {
    const h = new Map();
    const fail = (msg: string) => `CHECK RUN: \`test -f /app/x\` → FAILED (exit 1) in 5 ms\n${msg}`;
    expect(specCheckEvidence(h, 'test -f /app/x', fail('MISSING /app/x'), 'failed', 2, false)).toBe('failed');
    expect(specCheckEvidence(h, 'test -f /app/x', fail('MISSING /app/x'), 'failed', 2, false)).toBe('suspect');
    expect(specCheckEvidence(h, 'test -f /app/x', fail('MISSING /app/x'), 'failed', 2, true)).toBe('failed'); // another check failed too → still evidence
    expect(specCheckEvidence(h, 'test -f /app/x', fail('WRONG HEADER'), 'failed', 2, false)).toBe('failed'); // different failure → streak resets
    expect(specCheckEvidence(h, 'test -f /app/x', 'CHECK RUN: `test -f /app/x` → PASSED in 3 ms\n', 'passed', 2, false)).toBe('passed');
    expect(h.has('test -f /app/x')).toBe(false);
    expect(specCheckEvidence(h, 'y', 'CHECK RUN: `y` → TIMED OUT after 45000 ms (not a pass)\n', 'inconclusive', 2, false)).toBe('inconclusive');
  });
});

describe('endTurnResolver — R176 independent derivation config', () => {
  it('off by default; on/true/1; tolerance in (0,1) else 1e-3', () => {
    const d = resolveEndTurnResolverConfig({} as any);
    expect(d.derivation).toBe('off'); expect(d.derivationTol).toBe(1e-3);
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_INDEPENDENT_DERIVATION: 'on', CORTEX_JUDGE_INDEPENDENT_DERIVATION_TOL: '0.01' } as any)).toMatchObject({ derivation: 'on', derivationTol: 0.01 });
    expect(resolveEndTurnResolverConfig({ CORTEX_JUDGE_INDEPENDENT_DERIVATION: 'bogus', CORTEX_JUDGE_INDEPENDENT_DERIVATION_TOL: '5' } as any)).toMatchObject({ derivation: 'off', derivationTol: 1e-3 });
  });
});
