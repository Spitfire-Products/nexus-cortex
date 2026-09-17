import { describe, it, expect } from 'vitest';
import { resolveTurnContractEnforce, checkTurnFormat, buildFormatRejectMessage } from '../turnContractValidator.js';

describe('turnContractValidator — HB-TURN-CONTRACT-ENFORCE', () => {
  it('lever: off by default, on with true/1/on; max default 2, clamped 0..10', () => {
    expect(resolveTurnContractEnforce({} as any)).toEqual({ enforce: false, max: 2 });
    expect(resolveTurnContractEnforce({ CORTEX_TURN_CONTRACT_ENFORCE: 'true' } as any).enforce).toBe(true);
    expect(resolveTurnContractEnforce({ CORTEX_TURN_CONTRACT_ENFORCE: 'on', CORTEX_TURN_CONTRACT_ENFORCE_MAX: '4' } as any)).toEqual({ enforce: true, max: 4 });
    expect(resolveTurnContractEnforce({ CORTEX_TURN_CONTRACT_ENFORCE_MAX: '99' } as any).max).toBe(10);
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
