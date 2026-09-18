import { describe, it, expect } from 'vitest';
import { resolveTurnContractEnforce, checkTurnFormat, buildFormatRejectMessage, resolveActionPlanFields, planFieldsMissing, stripPlanFields, buildPlanFieldsRejectMessage, ACTION_PLAN_TOOLS, ACTION_PLAN_FIELD_PROPERTIES } from '../turnContractValidator.js';
import { BaseToolRegistry } from '../../tools/registries/BaseToolRegistry.js';

describe('turnContractValidator — HB-TURN-CONTRACT-ENFORCE', () => {
  it('lever: off by default, on with true/1/on; max default 2, clamped 0..10', () => {
    expect(resolveTurnContractEnforce({} as any)).toEqual({ enforce: false, max: 2 });
    expect(resolveTurnContractEnforce({ CORTEX_TURN_CONTRACT_ENFORCE: 'true' } as any).enforce).toBe(true);
    expect(resolveTurnContractEnforce({ CORTEX_TURN_CONTRACT_ENFORCE: 'on', CORTEX_TURN_CONTRACT_ENFORCE_MAX: '4' } as any)).toEqual({ enforce: true, max: 4 });
    expect(resolveTurnContractEnforce({ CORTEX_TURN_CONTRACT_ENFORCE_MAX: '99' } as any).max).toBe(99);
    expect(resolveTurnContractEnforce({ CORTEX_TURN_CONTRACT_ENFORCE_MAX: '99999' } as any).max).toBe(10000);
    expect(resolveTurnContractEnforce({ CORTEX_TURN_CONTRACT_ENFORCE_MAX: '0' } as any).max).toBe(0);
    expect(resolveTurnContractEnforce({ CORTEX_TURN_CONTRACT_ENFORCE: 'false' } as any).enforce).toBe(false);
  });
  it('format: both sections as line-leading labels pass; either missing fails; inline mentions do not count', () => {
    expect(checkTurnFormat('ANALYSIS — build passed, tests not yet run.\nPLAN — run pytest, then check the output file.')).toEqual({ ok: true, missing: [] });
    expect(checkTurnFormat('**ANALYSIS**: ok\n## PLAN\n1. run it').ok).toBe(true);
    expect(checkTurnFormat('1. Analysis: fine\n2. Plan: go').ok).toBe(true);
    expect(checkTurnFormat('Let me run the tests now.')).toEqual({ ok: false, missing: ['ANALYSIS', 'PLAN'] });
    expect(checkTurnFormat('ANALYSIS — done.\nNext I will run it.')).toEqual({ ok: false, missing: ['PLAN'] });
    expect(checkTurnFormat('my plan is to run analysis on the data')).toEqual({ ok: false, missing: ['ANALYSIS', 'PLAN'] });
    expect(checkTurnFormat('')).toEqual({ ok: false, missing: ['ANALYSIS', 'PLAN'] });
  });
  it('message: names the missing sections, the unexecuted tools, the bound, and the as-is fallback on the last rejection', () => {
    const m = buildFormatRejectMessage(['PLAN'], 1, 2, ['Bash', 'Bash']);
    expect(m).toContain('NOT executed'); expect(m).toContain('(Bash)'); expect(m).toContain('missing: PLAN'); expect(m).toContain('rejection 1 of 2'); expect(m).not.toContain('as-is');
    const m2 = buildFormatRejectMessage(['ANALYSIS', 'PLAN'], 2, 2, ['Read', 'Edit']);
    expect(m2).toContain('ANALYSIS and PLAN'); expect(m2).toContain('calls were'); expect(m2).toContain('executes as-is');
  });
});

describe('R172 HB-ACTION-PLAN-FIELDS', () => {
  it('lever: off by default; true/1/on enables', () => {
    expect(resolveActionPlanFields({} as any)).toBe(false);
    expect(resolveActionPlanFields({ CORTEX_ACTION_PLAN_FIELDS: 'true' } as any)).toBe(true);
    expect(resolveActionPlanFields({ CORTEX_ACTION_PLAN_FIELDS: 'false' } as any)).toBe(false);
  });
  it('validation: both fields required and non-blank; strip removes only those two', () => {
    expect(planFieldsMissing({ command: 'ls', analysis: 'a', plan: 'p' })).toEqual([]);
    expect(planFieldsMissing({ command: 'ls', analysis: '  ', plan: 'p' })).toEqual(['analysis']);
    expect(planFieldsMissing({ command: 'ls' })).toEqual(['analysis', 'plan']);
    expect(planFieldsMissing(undefined)).toEqual(['analysis', 'plan']);
    expect(stripPlanFields({ command: 'ls', timeout: 5, analysis: 'a', plan: 'p' })).toEqual({ command: 'ls', timeout: 5 });
    expect(stripPlanFields('x')).toBe('x');
  });
  it('message: names the tool and the missing fields, says not executed, asks for a re-issue', () => {
    const m = buildPlanFieldsRejectMessage('Bash', ['plan']);
    expect(m).toContain('Bash call REJECTED'); expect(m).toContain('not executed'); expect(m).toContain('field plan is missing'); expect(m).toContain('Re-issue');
    expect(buildPlanFieldsRejectMessage('Edit', ['analysis', 'plan'])).toContain('fields analysis and plan are missing');
  });
  it('registry: schemas gain the required fields only when the lever is on; other tools untouched', () => {
    const off = new BaseToolRegistry({} as any);
    for (const n of ACTION_PLAN_TOOLS) { const sch = (off.getTool(n) as any).schema; expect(sch.properties.analysis).toBeUndefined(); expect(sch.required).not.toContain('plan'); }
    const on = new BaseToolRegistry({ CORTEX_ACTION_PLAN_FIELDS: 'true' } as any);
    for (const n of ACTION_PLAN_TOOLS) { const sch = (on.getTool(n) as any).schema; expect(sch.properties.analysis).toEqual(ACTION_PLAN_FIELD_PROPERTIES.analysis); expect(sch.required).toContain('analysis'); expect(sch.required).toContain('plan'); }
    expect((on.getTool('Bash') as any).schema.required).toContain('command');
    expect((on.getTool('Read') as any).schema.required ?? []).not.toContain('plan');
  });
});
