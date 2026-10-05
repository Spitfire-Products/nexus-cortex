import { describe, it, expect } from 'vitest';
import {
  resolveTaskRules, taskRulesPlanBlock, taskRulesJudgeClause, TASK_RULES, TASK_RULE_ENV, TASK_RULE_PLAN_LINES, TASK_RULE_JUDGE_CLAUSES,
} from '../taskRules.js';
import { plannerSystem, PLANNER_SYSTEM_V1, PLANNER_SYSTEM, SCOPE_DOCTRINE, PLANNER_INVESTIGATE_CLAUSE } from '../liftPlanner.js';
import { resolverSystemPrompt, resolveEndTurnResolverConfig, RESOLVER_SCALE_CLAUSE, RESOLVER_ABSTAIN_CLAUSE } from '../endTurnResolver.js';

const ALL_ON = { CORTEX_RULE_INPUTS: 'on', CORTEX_RULE_INTERP: 'on', CORTEX_RULE_HOLDOUT: 'on', CORTEX_RULE_INDEP: 'on' } as NodeJS.ProcessEnv;

describe('R211–R214 resolveTaskRules', () => {
  it('off by default and for non-truthy values', () => {
    expect(resolveTaskRules({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(resolveTaskRules({ CORTEX_RULE_INPUTS: 'off', CORTEX_RULE_INTERP: '0', CORTEX_RULE_HOLDOUT: 'false', CORTEX_RULE_INDEP: '' } as NodeJS.ProcessEnv)).toEqual([]);
  });
  it('each flag is independent; on | true | 1 (any case, trimmed); canonical order', () => {
    expect(resolveTaskRules({ CORTEX_RULE_INDEP: ' ON ', CORTEX_RULE_INPUTS: '1' } as NodeJS.ProcessEnv)).toEqual(['inputs', 'indep']);
    expect(resolveTaskRules({ CORTEX_RULE_HOLDOUT: 'true' } as NodeJS.ProcessEnv)).toEqual(['holdout']);
    expect(resolveTaskRules(ALL_ON)).toEqual(['inputs', 'interp', 'holdout', 'indep']);
    expect(TASK_RULE_ENV).toEqual({ inputs: 'CORTEX_RULE_INPUTS', interp: 'CORTEX_RULE_INTERP', holdout: 'CORTEX_RULE_HOLDOUT', indep: 'CORTEX_RULE_INDEP' });
  });
});

describe('R211–R214 carrier text', () => {
  it('empty rule set → empty block and empty clause', () => {
    expect(taskRulesPlanBlock([])).toBe('');
    expect(taskRulesJudgeClause([])).toBe('');
  });
  it('one bullet / clause per rule, canonical order regardless of input order', () => {
    expect(taskRulesPlanBlock(['indep', 'inputs'])).toBe(TASK_RULE_PLAN_LINES.inputs + TASK_RULE_PLAN_LINES.indep);
    expect(taskRulesJudgeClause(['indep', 'inputs'])).toBe(TASK_RULE_JUDGE_CLAUSES.inputs + TASK_RULE_JUDGE_CLAUSES.indep);
  });
  it('plan bullets share the doctrine-bullet shape; judge clauses share the R208 clause shape', () => {
    for (const r of TASK_RULES) {
      expect(TASK_RULE_PLAN_LINES[r]).toMatch(/^- [A-Z -]+: /);
      expect(TASK_RULE_PLAN_LINES[r].endsWith('\n')).toBe(true);
      expect(TASK_RULE_JUDGE_CLAUSES[r]).toMatch(/^\n\n[A-Z -]+ RULE \(HB-RULE-[A-Z]+\): /);
      expect(TASK_RULE_JUDGE_CLAUSES[r]).toMatch(/GAP/);
      expect(TASK_RULE_JUDGE_CLAUSES[r]).toMatch(/CHECK/);
    }
  });
  it('each line carries its rule', () => {
    expect(TASK_RULE_PLAN_LINES.inputs).toMatch(/every field, column and parameter/);
    expect(TASK_RULE_PLAN_LINES.inputs).toMatch(/Never alter a given value to make the problem feasible/);
    // 2026-10-05: the rule has an EXIT — one re-read, then decide and proceed (atrx-vep-crispr looped forever on a real input typo)
    expect(TASK_RULE_PLAN_LINES.inputs).toMatch(/re-read once/);
    expect(TASK_RULE_PLAN_LINES.inputs).toMatch(/do not keep re-reading/);
    expect(TASK_RULE_JUDGE_CLAUSES.inputs).toMatch(/is not a gap/);
    expect(TASK_RULE_PLAN_LINES.interp).toMatch(/consistent with every explicit hint and all of the data/);
    expect(TASK_RULE_PLAN_LINES.holdout).toMatch(/held-out split or constructed variants/);
    expect(TASK_RULE_PLAN_LINES.indep).toMatch(/does not reuse the producing logic/);
    expect(TASK_RULE_JUDGE_CLAUSES.indep).toMatch(/discrepancy\s+left unreconciled/);
  });
  it('wording never asks for less work: no stop / finish-early language', () => {
    for (const r of TASK_RULES) {
      for (const t of [TASK_RULE_PLAN_LINES[r], TASK_RULE_JUDGE_CLAUSES[r]]) {
        expect(t).not.toMatch(/\b(stop|skip|early|enough|give up|retire)\b/i);
      }
    }
  });
});

describe('R211–R214 carrier A — planner persona', () => {
  it('all off → byte-identical to today (v1, v2, with scope, with investigate)', () => {
    const OFF = { CORTEX_RULE_INPUTS: 'off' } as NodeJS.ProcessEnv;
    expect(plannerSystem({} as NodeJS.ProcessEnv)).toBe(PLANNER_SYSTEM_V1);
    expect(plannerSystem(OFF)).toBe(PLANNER_SYSTEM_V1);
    expect(plannerSystem({ ...OFF, CORTEX_LIFT_PLAN_DOCTRINE: 'v2' })).toBe(PLANNER_SYSTEM);
    expect(plannerSystem({ ...OFF, CORTEX_LIFT_PLAN_SCOPE: 'true' })).toBe(PLANNER_SYSTEM_V1.replace('Output ONLY the plan', SCOPE_DOCTRINE + 'Output ONLY the plan'));
    expect(plannerSystem(OFF, 'offer')).toBe(PLANNER_SYSTEM_V1 + PLANNER_INVESTIGATE_CLAUSE);
  });
  it('on → one combined block just before the output instruction (after the scope bullet)', () => {
    const block = taskRulesPlanBlock(['inputs', 'interp', 'holdout', 'indep']);
    expect(plannerSystem(ALL_ON)).toBe(PLANNER_SYSTEM_V1.replace('Output ONLY the plan', block + 'Output ONLY the plan'));
    expect(plannerSystem({ ...ALL_ON, CORTEX_LIFT_PLAN_SCOPE: 'true' })).toBe(PLANNER_SYSTEM_V1.replace('Output ONLY the plan', SCOPE_DOCTRINE + block + 'Output ONLY the plan'));
    expect(plannerSystem({ CORTEX_RULE_HOLDOUT: 'on' } as NodeJS.ProcessEnv, 'offer').endsWith(PLANNER_INVESTIGATE_CLAUSE)).toBe(true);
    expect(plannerSystem({ CORTEX_RULE_HOLDOUT: 'on' } as NodeJS.ProcessEnv)).toContain(TASK_RULE_PLAN_LINES.holdout);
    expect(plannerSystem({ CORTEX_RULE_HOLDOUT: 'on' } as NodeJS.ProcessEnv)).not.toContain(TASK_RULE_PLAN_LINES.inputs);
  });
});

describe('R211–R214 carrier B — judge persona', () => {
  it('config: default none; resolves the active rules', () => {
    expect(resolveEndTurnResolverConfig({} as NodeJS.ProcessEnv).taskRules).toEqual([]);
    expect(resolveEndTurnResolverConfig({ CORTEX_RULE_INTERP: 'on' } as NodeJS.ProcessEnv).taskRules).toEqual(['interp']);
  });
  it('no rules → byte-identical to the 4-arg persona (all flag combinations)', () => {
    for (const abstain of [false, true]) for (const mc of [false, true]) for (const vs of [false, true]) for (const inv of [undefined, 'offer', 'withdraw'] as const) {
      expect(resolverSystemPrompt(abstain, mc, inv, vs, [])).toBe(resolverSystemPrompt(abstain, mc, inv, vs));
    }
  });
  it('rules → clauses appended after the scale item, before abstain / investigate', () => {
    const p = resolverSystemPrompt(true, false, 'offer', true, ['holdout', 'inputs']);
    const iScale = p.indexOf(RESOLVER_SCALE_CLAUSE);
    const iRules = p.indexOf(TASK_RULE_JUDGE_CLAUSES.inputs + TASK_RULE_JUDGE_CLAUSES.holdout);
    expect(iScale).toBeGreaterThan(0);
    expect(iRules).toBe(iScale + RESOLVER_SCALE_CLAUSE.length);
    expect(p.indexOf(RESOLVER_ABSTAIN_CLAUSE)).toBe(iRules + taskRulesJudgeClause(['inputs', 'holdout']).length);
    expect(resolverSystemPrompt(false, false, undefined, false, ['indep']).endsWith(TASK_RULE_JUDGE_CLAUSES.indep)).toBe(true);
  });
});
