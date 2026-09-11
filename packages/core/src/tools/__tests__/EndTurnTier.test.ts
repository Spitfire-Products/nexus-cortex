import { describe, it, expect } from 'vitest';
import { BaseToolRegistry } from '../registries/BaseToolRegistry';

describe('CORTEX_ENDTURN_TIER (4.107.2 lever)', () => {
  it('defaults EndTurn to the standard (deferred) tier — the 4.107.0 baseline', () => {
    expect(new BaseToolRegistry({}).getTool('EndTurn')?.discoveryTier).toBe('standard');
    expect(new BaseToolRegistry({ CORTEX_ENDTURN_TIER: '' }).getTool('EndTurn')?.discoveryTier).toBe('standard');
  });
  it('essential lifts EndTurn into the turn-1 set; standard keeps it deferred; junk is ignored', () => {
    expect(new BaseToolRegistry({ CORTEX_ENDTURN_TIER: 'essential' }).getTool('EndTurn')?.discoveryTier).toBe('essential');
    expect(new BaseToolRegistry({ CORTEX_ENDTURN_TIER: ' Essential ' }).getTool('EndTurn')?.discoveryTier).toBe('essential');
    expect(new BaseToolRegistry({ CORTEX_ENDTURN_TIER: 'standard' }).getTool('EndTurn')?.discoveryTier).toBe('standard');
    expect(new BaseToolRegistry({ CORTEX_ENDTURN_TIER: 'bogus' }).getTool('EndTurn')?.discoveryTier).toBe('standard');
  });
  it('does not mutate the shared base definition', () => {
    new BaseToolRegistry({ CORTEX_ENDTURN_TIER: 'essential' });
    expect(new BaseToolRegistry({}).getTool('EndTurn')?.discoveryTier).toBe('standard');
  });
});
