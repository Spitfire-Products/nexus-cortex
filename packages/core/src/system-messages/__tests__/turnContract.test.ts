/**
 * HB-TURN-CONTRACT (2026-09-17): suppress vs channel — the boot-minimal door's "prefer acting" clause is swapped for the
 * analysis/plan/action output contract when CORTEX_TURN_CONTRACT=channel; byte-identical otherwise.
 */
import { describe, it, expect } from 'vitest';
import { applyTurnContract, buildBootMinimalPrompt, resolveTurnContract, BOOT_MINIMAL_PROMPT, TURN_CONTRACT_CLAUSE, SUPPRESS_CLAUSE } from '../promptPresets.js';
import { reasoningExhaustionNudge, resolveReasoningExhaustBackoff } from '../../orchestrator/emptyResponseClassifier.js';

describe('resolveTurnContract', () => {
  it('defaults to the shipped door; only "channel" selects the contract', () => {
    expect(resolveTurnContract({} as any)).toBe('');
    expect(resolveTurnContract({ CORTEX_TURN_CONTRACT: 'channel' } as any)).toBe('channel');
    expect(resolveTurnContract({ CORTEX_TURN_CONTRACT: 'CHANNEL ' } as any)).toBe('channel');
    expect(resolveTurnContract({ CORTEX_TURN_CONTRACT: 'bogus' } as any)).toBe('');
  });
});

describe('applyTurnContract / buildBootMinimalPrompt', () => {
  it('default: byte-identical prompt, suppression clause present', () => {
    expect(applyTurnContract(BOOT_MINIMAL_PROMPT, {} as any)).toBe(BOOT_MINIMAL_PROMPT);
    expect(buildBootMinimalPrompt(undefined, {} as any)).toContain(SUPPRESS_CLAUSE.trim());
    expect(buildBootMinimalPrompt('/x/orient', {} as any)).toContain(SUPPRESS_CLAUSE.trim());
  });
  it('channel: suppression clause removed, contract appended, on both prompt variants', () => {
    const env = { CORTEX_TURN_CONTRACT: 'channel' } as any;
    for (const p of [buildBootMinimalPrompt(undefined, env), buildBootMinimalPrompt('/x/orient', env)]) {
      expect(p).not.toContain('Prefer acting over deliberating');
      expect(p).toContain('ANALYSIS');
      expect(p).toContain('PLAN');
      expect(p.endsWith(TURN_CONTRACT_CLAUSE)).toBe(true);
    }
    expect(buildBootMinimalPrompt('/x/orient', env)).toContain('sh /x/orient');
  });
});

describe('length recovery under the contract', () => {
  it('channel nudge names the cap and asks to re-issue; default nudge unchanged', () => {
    const ch = reasoningExhaustionNudge(undefined, { contract: 'channel', outputCap: 65536 });
    expect(ch).toContain('65536 tokens');
    expect(ch).toContain('NONE of the actions');
    expect(ch).not.toContain('temporarily lowered');
    expect(reasoningExhaustionNudge('medium', { contract: '' })).toContain("temporarily lowered to 'medium'");
  });
  it('backoff defaults off in channel mode, on otherwise, explicit value wins', () => {
    expect(resolveReasoningExhaustBackoff({} as any).enabled).toBe(true);
    expect(resolveReasoningExhaustBackoff({ CORTEX_TURN_CONTRACT: 'channel' } as any).enabled).toBe(false);
    expect(resolveReasoningExhaustBackoff({ CORTEX_TURN_CONTRACT: 'channel', CORTEX_REASONING_EXHAUST_BACKOFF: 'true' } as any).enabled).toBe(true);
  });
});
