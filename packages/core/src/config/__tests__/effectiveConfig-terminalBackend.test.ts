import { describe, it, expect } from 'vitest';
import { collectEffectiveConfig } from '../effectiveConfig.js';
import { DEFAULT_SETTINGS, SETTINGS_METADATA } from '../SettingsSchema.js';
import { getRuntimeConfigEntry } from '../RuntimeConfigRegistry.js';

const KEY = 'CORTEX_TERMINAL_BACKEND';

function find(env: NodeJS.ProcessEnv, key: string) {
  for (const g of collectEffectiveConfig(env)) {
    const l = g.levers.find((x) => x.key === key);
    if (l) return l;
  }
  return undefined;
}

describe('R146 CORTEX_TERMINAL_BACKEND is registered the canonical way', () => {
  it('defaults to auto and reads the env value', () => {
    const off = find({}, KEY);
    expect(off).toBeDefined();
    expect(off!.codeDefault).toBe('auto');
    expect(off!.source).toBe('code-default');
    const on = find({ [KEY]: 'tmux' }, KEY);
    expect(on!.source).toBe('env');
    expect(on!.effective).toBe('tmux');
  });

  it('SettingsSchema declares an empty default + a schema entry, and the runtime registry tiers it as env', () => {
    expect((DEFAULT_SETTINGS as Record<string, unknown>)[KEY]).toBe('');
    expect(SETTINGS_METADATA.find((m) => m.key === KEY)).toBeDefined();
    expect(getRuntimeConfigEntry(KEY)?.tier).toBe('env');
  });
});
