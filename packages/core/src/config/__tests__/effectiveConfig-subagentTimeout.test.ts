import { describe, it, expect } from 'vitest';
import { collectEffectiveConfig } from '../effectiveConfig.js';
import { DEFAULT_SETTINGS, SETTINGS_METADATA } from '../SettingsSchema.js';
import { getRuntimeConfigEntry } from '../RuntimeConfigRegistry.js';

const KEYS = ['CORTEX_SUBAGENT_TIMEOUT_MS', 'CORTEX_SUBAGENT_TIMEOUT_MAX_MS'] as const;

function find(env: NodeJS.ProcessEnv, key: string) {
  for (const g of collectEffectiveConfig(env)) {
    const l = g.levers.find((x) => x.key === key);
    if (l) return l;
  }
  return undefined;
}

describe('R133 sub-agent timeout levers are registered the canonical way', () => {
  it('effective_config banks both levers with env source attribution', () => {
    for (const key of KEYS) {
      const off = find({}, key);
      expect(off, key).toBeDefined();
      expect(off!.source).toBe('code-default');
      const on = find({ [key]: '900000' }, key);
      expect(on!.source).toBe('env');
      expect(on!.effective).toBe('900000');
    }
    expect(find({}, 'CORTEX_SUBAGENT_TIMEOUT_MS')!.codeDefault).toBe('300000');
  });

  it('SettingsSchema declares an empty default + a schema entry, and the runtime registry tiers them as env', () => {
    for (const key of KEYS) {
      expect((DEFAULT_SETTINGS as Record<string, unknown>)[key], key).toBe('');
      expect(SETTINGS_METADATA.find((m) => m.key === key), key).toBeDefined();
      expect(getRuntimeConfigEntry(key)?.tier, key).toBe('env');
    }
  });
});
