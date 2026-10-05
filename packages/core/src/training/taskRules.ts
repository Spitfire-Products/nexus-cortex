/**
 * R211–R214 HB-TASK-RULES (dark, 2026-10-02). Four general verification rules from the TB4.0 requirement-miss pass over the 16
 * never-passed tasks that fail one identical hidden test every run (.cortex/research/tb4-never-passed-2026-10-02.md §Requirement-miss
 * pass): input overlooked / given input altered, ambiguous convention settled by heuristic, overfit to the visible sample, fidelity with
 * no independent check. Each rule is its own env flag (A/B-able) and rides TWO carriers:
 *
 *   A — planner: one doctrine bullet per active rule in the lift-plan persona (liftPlanner.plannerSystem), so the plan carries the step.
 *   B — judge:   one rubric clause per active rule appended to the EndTurn judge persona (endTurnResolver.resolverSystemPrompt),
 *                exactly like R208's RESOLVER_SCALE_CLAUSE: evidence that does not establish the rule → GAP with a concrete CHECK.
 *
 *   CORTEX_RULE_INPUTS  = off (default) | on   R211 L1 input-coverage audit
 *   CORTEX_RULE_INTERP  = off (default) | on   R212 L2 interpretation enumeration
 *   CORTEX_RULE_HOLDOUT = off (default) | on   R213 L3 held-out / variant validation
 *   CORTEX_RULE_INDEP   = off (default) | on   R214 L4 independent verifier
 *
 * All off → both personas byte-identical. The rules only ever ask for MORE verification. Pure apart from the env read.
 */

export type TaskRule = 'inputs' | 'interp' | 'holdout' | 'indep';

/** Canonical order (block and clause order never depend on env iteration order). */
export const TASK_RULES: readonly TaskRule[] = ['inputs', 'interp', 'holdout', 'indep'];

export const TASK_RULE_ENV: Record<TaskRule, string> = {
  inputs: 'CORTEX_RULE_INPUTS',
  interp: 'CORTEX_RULE_INTERP',
  holdout: 'CORTEX_RULE_HOLDOUT',
  indep: 'CORTEX_RULE_INDEP',
};

/** Active rules, canonical order. A rule is on for on | true | 1 (case-insensitive); anything else is off. */
export function resolveTaskRules(env: NodeJS.ProcessEnv = process.env): TaskRule[] {
  return TASK_RULES.filter((r) => /^(on|true|1)$/i.test((env[TASK_RULE_ENV[r]] ?? '').trim()));
}

/** Carrier A: one planner doctrine bullet per rule (same `- NAME: …\n` shape as the other doctrine bullets). */
export const TASK_RULE_PLAN_LINES: Record<TaskRule, string> = {
  inputs:
    '- INPUT COVERAGE: include a step that lists every field, column and parameter of the provided inputs and where the solution uses ' +
    'each one. Never alter a given value to make the problem feasible. If two provided sources disagree, or a given value is internally ' +
    'inconsistent, re-read once; if the conflict is real, use the source the task names as authoritative (else the task text itself), ' +
    'record the discrepancy in the deliverable\'s notes, and proceed — do not keep re-reading.\n',
  interp:
    '- INTERPRETATIONS: when the task or the work names alternative readings, conventions or candidates, include a step that computes ' +
    'each one and keeps the one consistent with every explicit hint and all of the data, stating why.\n',
  holdout:
    '- HELD-OUT VALIDATION: when the task implies hidden inputs, other variants or generalisation, include a step that validates on a ' +
    'held-out split or constructed variants, not only the visible sample.\n',
  indep:
    '- INDEPENDENT CHECK: include a final check that does not reuse the producing logic (a separate method or recomputation), resolve ' +
    'every measured discrepancy before finishing, and run the task\'s own verification commands within its stated limits.\n',
};

/** The combined planner block for the active rules ('' when none). */
export function taskRulesPlanBlock(rules: readonly TaskRule[]): string {
  return TASK_RULES.filter((r) => rules.includes(r)).map((r) => TASK_RULE_PLAN_LINES[r]).join('');
}

/** Carrier B: one judge rubric clause per rule (same `\n\nNAME RULE (HB-…): question? If … treat that as a GAP and name a CHECK …` shape
 *  as RESOLVER_SCALE_CLAUSE). */
export const TASK_RULE_JUDGE_CLAUSES: Record<TaskRule, string> = {
  inputs:
    '\n\nINPUTS RULE (HB-RULE-INPUTS): when the task provides input data, parameters or constants, does the work use them and leave the ' +
    'given values unchanged? If a provided field is ignored or a given value was altered to make the problem feasible, treat that as a GAP ' +
    'and name a CHECK that shows where that input is used. Tasks with no provided inputs are not affected by this rule. A recorded, ' +
    'justified discrepancy between provided sources, resolved in favour of the task\'s authoritative source, is not a gap.',
  interp:
    '\n\nINTERPRETATION RULE (HB-RULE-INTERP): where the task or the work names alternative readings, conventions or candidates, does ' +
    'the evidence show each one was computed and the chosen one is consistent with every explicit hint and all the data? If an ' +
    'alternative was set aside without that comparison, treat that as a GAP and name a CHECK that scores the alternatives against the ' +
    'hints and the data.',
  holdout:
    '\n\nHELD-OUT RULE (HB-RULE-HOLDOUT): if the task implies hidden inputs, other variants or generalisation, does the verification ' +
    'go beyond the visible sample (a held-out split or constructed variants)? If the evidence covers only the visible sample, treat ' +
    'that as a GAP and name a CHECK on held-out or constructed variant inputs.',
  indep:
    '\n\nINDEPENDENT-CHECK RULE (HB-RULE-INDEP): is the final verification independent of the logic that produced the result — the ' +
    'task\'s own tests or commands within their stated limits, or a separate method — rather than a self-check that only restates the ' +
    'producing code\'s own output? Running the task\'s own tests counts as independent. A self-only check, or a measured discrepancy left ' +
    'unreconciled, is a GAP: name an independent CHECK that settles it.',
};

/** The combined judge clauses for the active rules ('' when none). */
export function taskRulesJudgeClause(rules: readonly TaskRule[]): string {
  return TASK_RULES.filter((r) => rules.includes(r)).map((r) => TASK_RULE_JUDGE_CLAUSES[r]).join('');
}
