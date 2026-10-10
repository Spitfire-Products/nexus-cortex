import { describe, it, expect } from 'vitest';
import { collectEffectiveConfig } from '../effectiveConfig.js';
import { DEFAULT_SETTINGS, SETTINGS_METADATA } from '../SettingsSchema.js';
import { getRuntimeConfigEntry } from '../RuntimeConfigRegistry.js';

const KEYS = ['CORTEX_SECOND_ATTEMPT', 'CORTEX_SECOND_ATTEMPT_MAX', 'CORTEX_SECOND_ATTEMPT_MIN_REMAINING', 'CORTEX_SECOND_ATTEMPT_TRIGGER', 'CORTEX_SECOND_ATTEMPT_RESERVE_MS', 'CORTEX_SECOND_ATTEMPT_FLOOR_MS', 'CORTEX_SECOND_ATTEMPT_OUT_DIR'];
function find(env: Record<string, string>, key: string) {
  for (const g of collectEffectiveConfig(env)) { const l = g.levers.find((x) => x.key === key); if (l) return l; }
  return undefined;
}

describe('R239 / P4 second-attempt levers are registered everywhere a lever must be', () => {
  it('every key is reported by the effective-config report (the bench gate asserts against it) with its code default', () => {
    for (const k of KEYS) expect(find({}, k), k).toBeDefined();
    expect(find({}, 'CORTEX_SECOND_ATTEMPT')!.codeDefault).toContain('off');
    expect(find({}, 'CORTEX_SECOND_ATTEMPT_MAX')!.codeDefault).toBe('1');
    expect(find({}, 'CORTEX_SECOND_ATTEMPT_TRIGGER')!.codeDefault).toBe('accept-with-gap,accept-low-confidence,accept,none');
    const on = find({ CORTEX_SECOND_ATTEMPT: '1', CORTEX_SECOND_ATTEMPT_TRIGGER: 'accept,none' }, 'CORTEX_SECOND_ATTEMPT_TRIGGER')!;
    expect(on.effective).toBe('accept,none'); expect(on.source).toBe('env');
  });
  it('SettingsSchema declares an empty default + a schema entry, and the runtime registry tiers each as env', () => {
    for (const k of KEYS) {
      expect((DEFAULT_SETTINGS as Record<string, unknown>)[k], k).toBe('');
      expect(SETTINGS_METADATA.find((m) => m.key === k), k).toBeDefined();
      expect(getRuntimeConfigEntry(k)?.tier, k).toBe('env');
    }
  });
});
