/**
 * R138 / R141 (HB-TERMINUS-LESSONS, 2026-09-14): the tmux levers are registered the
 * canonical way (effectiveConfig table + SettingsSchema + SettingsLoader + registry).
 */
import { describe, it, expect } from 'vitest';
import { collectEffectiveConfig } from '../effectiveConfig.js';
import { DEFAULT_SETTINGS, SETTINGS_METADATA } from '../SettingsSchema.js';
import { getRuntimeConfigEntry } from '../RuntimeConfigRegistry.js';

const KEYS = ['CORTEX_TMUX_AUTO_INSTALL', 'CORTEX_TMUX_STATIC_URL', 'CORTEX_TMUX_HISTORY_LIMIT', 'CORTEX_TMUX_PANE_SIZE'] as const;

function find(env: NodeJS.ProcessEnv, key: string) {
  for (const g of collectEffectiveConfig(env)) {
    const l = g.levers.find((x) => x.key === key);
    if (l) return l;
  }
  return undefined;
}

describe('R138/R141 tmux levers are registered the canonical way', () => {
  it('appear in the effective-config table with their code defaults and read the env', () => {
    expect(find({}, 'CORTEX_TMUX_AUTO_INSTALL')!.codeDefault).toBe('true');
    expect(find({}, 'CORTEX_TMUX_AUTO_INSTALL')!.source).toBe('code-default');
    expect(find({ CORTEX_TMUX_AUTO_INSTALL: 'false' }, 'CORTEX_TMUX_AUTO_INSTALL')!.source).toBe('env');
    expect(find({}, 'CORTEX_TMUX_STATIC_URL')!.codeDefault).toMatch(/unset/);
    expect(find({}, 'CORTEX_TMUX_HISTORY_LIMIT')!.codeDefault).toBe('50000');
    expect(find({ CORTEX_TMUX_HISTORY_LIMIT: '1000' }, 'CORTEX_TMUX_HISTORY_LIMIT')!.effective).toBe('1000');
    expect(find({}, 'CORTEX_TMUX_PANE_SIZE')!.codeDefault).toBe('160x40');
    expect(find({ CORTEX_TMUX_PANE_SIZE: '200x50' }, 'CORTEX_TMUX_PANE_SIZE')!.effective).toBe('200x50');
  });

  it('SettingsSchema declares an empty default + a schema entry, and the runtime registry tiers each as env', () => {
    for (const key of KEYS) {
      expect((DEFAULT_SETTINGS as Record<string, unknown>)[key]).toBe('');
      expect(SETTINGS_METADATA.find((m) => m.key === key)).toBeDefined();
      expect(getRuntimeConfigEntry(key)?.tier).toBe('env');
    }
  });
});
