import { describe, it, expect } from 'vitest';
import { collectEffectiveConfig } from '../effectiveConfig.js';
import { DEFAULT_SETTINGS, SETTINGS_METADATA } from '../SettingsSchema.js';
import { getRuntimeConfigEntry } from '../RuntimeConfigRegistry.js';

const KEYS = ['CORTEX_HERDR_REPORTING', 'CORTEX_HERDR_AGENT_NAME'] as const;

function find(env: NodeJS.ProcessEnv, key: string) {
  for (const g of collectEffectiveConfig(env)) {
    const l = g.levers.find((x) => x.key === key);
    if (l) return l;
  }
  return undefined;
}

describe('R145 herdr lifecycle levers are registered the canonical way', () => {
  it('CORTEX_HERDR_REPORTING is a flag-not-false lever with env source attribution', () => {
    const key = 'CORTEX_HERDR_REPORTING';
    const off = find({}, key);
    expect(off).toBeDefined();
    expect(off!.source).toBe('code-default');
    expect(off!.active).toBe(true);
    const disabled = find({ [key]: 'false' }, key);
    expect(disabled!.source).toBe('env');
    expect(disabled!.effective).toBe('false');
    expect(disabled!.active).toBe(false);
  });

  it('CORTEX_HERDR_AGENT_NAME defaults to cortex and reads the env value', () => {
    const key = 'CORTEX_HERDR_AGENT_NAME';
    expect(find({}, key)!.codeDefault).toBe('cortex');
    expect(find({}, key)!.source).toBe('code-default');
    const on = find({ [key]: 'builder' }, key);
    expect(on!.source).toBe('env');
    expect(on!.effective).toBe('builder');
  });

  it('the resolved-binary inputs (CORTEX_HERDR_BIN override, HERDR_BIN_PATH pane export) are visible in the dump', () => {
    expect(find({}, 'CORTEX_HERDR_BIN')!.source).toBe('code-default');
    expect(find({ CORTEX_HERDR_BIN: '/opt/herdr' }, 'CORTEX_HERDR_BIN')!.effective).toBe('/opt/herdr');
    const exported = find({ HERDR_BIN_PATH: '/home/runner/workspace/.local/bin/herdr' }, 'HERDR_BIN_PATH');
    expect(exported!.source).toBe('env');
    expect(exported!.effective).toBe('/home/runner/workspace/.local/bin/herdr');
  });

  it('SettingsSchema declares an empty default + a schema entry, and the runtime registry tiers them as env', () => {
    for (const key of KEYS) {
      expect((DEFAULT_SETTINGS as Record<string, unknown>)[key], key).toBe('');
      expect(SETTINGS_METADATA.find((m) => m.key === key), key).toBeDefined();
      expect(getRuntimeConfigEntry(key)?.tier, key).toBe('env');
    }
  });
});
