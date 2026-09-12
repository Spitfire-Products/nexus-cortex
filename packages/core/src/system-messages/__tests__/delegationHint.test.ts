import { describe, it, expect } from 'vitest';
import { buildBootMinimalPrompt, resolveDelegationHint, DELEGATION_HINT_CLAUSE, BOOT_MINIMAL_PROMPT } from '../promptPresets';

describe('HB-DELEGATION-DOCTRINE (4.108.1, dark lever)', () => {
  it('is OFF by default and only true/1/on enables it', () => {
    expect(resolveDelegationHint({})).toBe(false);
    expect(resolveDelegationHint({ CORTEX_DELEGATION_HINT: 'false' })).toBe(false);
    expect(resolveDelegationHint({ CORTEX_DELEGATION_HINT: 'true' })).toBe(true);
    expect(resolveDelegationHint({ CORTEX_DELEGATION_HINT: ' ON ' })).toBe(true);
  });
  it('leaves the measured narrow door byte-identical when off', () => {
    expect(buildBootMinimalPrompt(undefined, {})).toBe(BOOT_MINIMAL_PROMPT);
    expect(buildBootMinimalPrompt('/x/.cortex/orient', {})).not.toContain('Task tool');
  });
  it('appends exactly one clause naming the Task tool when on (both orient variants)', () => {
    const a = buildBootMinimalPrompt(undefined, { CORTEX_DELEGATION_HINT: 'true' });
    const b = buildBootMinimalPrompt('/x/.cortex/orient', { CORTEX_DELEGATION_HINT: 'true' });
    expect(a).toBe(BOOT_MINIMAL_PROMPT + DELEGATION_HINT_CLAUSE);
    expect(b.endsWith(DELEGATION_HINT_CLAUSE)).toBe(true);
    expect((b.match(/Task tool/g) || []).length).toBe(1);
  });
});
