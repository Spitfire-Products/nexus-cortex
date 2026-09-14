import { describe, it, expect } from 'vitest';
import { collectEffectiveConfig } from '../effectiveConfig.js';
import { DEFAULT_SETTINGS, SETTINGS_METADATA } from '../SettingsSchema.js';
import { getRuntimeConfigEntry } from '../RuntimeConfigRegistry.js';

const KEYS = ['CORTEX_COMPACTION_HANDOFF_QA', 'CORTEX_COMPACTION_HANDOFF_QA_MAX_QUESTIONS'] as const;

function find(env: NodeJS.ProcessEnv, key: string) {
  for (const g of collectEffectiveConfig(env)) {
    const l = g.levers.find((x) => x.key === key);
    if (l) return l;
  }
  return undefined;
}

describe('R143 CORTEX_COMPACTION_HANDOFF_QA levers are registered the canonical way', () => {
  it('handoff QA defaults false (dark) and reads the env value; max questions defaults 6', () => {
    const off = find({}, KEYS[0]);
    expect(off).toBeDefined();
    expect(off!.codeDefault).toBe('false');
    expect(off!.source).toBe('code-default');
    const on = find({ [KEYS[0]]: 'true' }, KEYS[0]);
    expect(on!.source).toBe('env');
    expect(on!.effective).toBe('true');
    expect(find({}, KEYS[1])!.codeDefault).toBe('6');
  });
  it('SettingsSchema declares an empty default + a schema entry, and the runtime registry tiers both as env', () => {
    for (const k of KEYS) {
      expect((DEFAULT_SETTINGS as Record<string, unknown>)[k]).toBe('');
      expect(SETTINGS_METADATA.find((m) => m.key === k)).toBeDefined();
      expect(getRuntimeConfigEntry(k)?.tier).toBe('env');
    }
  });
});
