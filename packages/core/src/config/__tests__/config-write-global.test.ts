/**
 * The read-live config-write model: /config surfaces write SPARSE overrides to the GLOBAL
 * ~/.cortex/.env, and RESET removes override lines so levers fall back to the shipped
 * defaults. os.homedir is mocked into a temp dir so ~/.cortex resolves there.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => process.env.__CW_HOME__ || actual.homedir() };
});

import {
  setGlobalSetting, removeGlobalSetting, removeEnvSetting, getGlobalEnvPath,
  SettingsLoader, parseEnvFile,
} from '../SettingsLoader.js';

describe('config write — global + sparse + remove-on-reset', () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(tmpdir(), 'cw-home-'));
    process.env.__CW_HOME__ = home;
  });
  afterEach(() => {
    delete process.env.__CW_HOME__;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('setGlobalSetting writes a sparse override to ~/.cortex/.env (one line, others intact)', () => {
    const p = getGlobalEnvPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '# keys\nDEEPSEEK_API_KEY=sk-mine\n');

    setGlobalSetting('CORTEX_ENDTURN_GATE', 'false');

    const parsed = parseEnvFile(fs.readFileSync(p, 'utf-8'));
    expect(parsed.CORTEX_ENDTURN_GATE).toBe('false'); // the one override
    expect(parsed.DEEPSEEK_API_KEY).toBe('sk-mine');   // untouched
    // sparse: only the key we set is a lever line — no full-file lever dump
    const leverLines = fs.readFileSync(p, 'utf-8').split('\n').filter(l => /^CORTEX_|^MENTORSHIP_|^ENABLE_/.test(l));
    expect(leverLines).toEqual(['CORTEX_ENDTURN_GATE=false']);
  });

  it('removeEnvSetting deletes only the target line, preserving comments + other keys', () => {
    const p = getGlobalEnvPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '# header\nDEEPSEEK_API_KEY=sk-mine\nCORTEX_LIFT_PLAN=false\nYOLO=true\n');

    const r = removeEnvSetting(home + '/.cortex', 'CORTEX_LIFT_PLAN');
    expect(r.success).toBe(true);
    expect(r.previousValue).toBe('false');

    const after = fs.readFileSync(p, 'utf-8');
    expect(after).toContain('# header');
    expect(after).toContain('DEEPSEEK_API_KEY=sk-mine');
    expect(after).toContain('YOLO=true');
    expect(after).not.toContain('CORTEX_LIFT_PLAN');
  });

  it('removing a key that is not set is a no-op success', () => {
    const p = getGlobalEnvPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'DEEPSEEK_API_KEY=sk-mine\n');
    const r = removeGlobalSetting('CORTEX_ENDTURN_GATE');
    expect(r.success).toBe(true);
    expect(r.previousValue).toBeUndefined();
  });

  it('resetAllToDefaults removes lever overrides but PRESERVES API keys', () => {
    const p = getGlobalEnvPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, [
      'DEEPSEEK_API_KEY=sk-keep',
      'ANTHROPIC_API_KEY=sk-ant-keep',
      'CORTEX_ENDTURN_GATE=false',
      'MENTORSHIP_ENABLED=false',
      'YOLO=true',
      '',
    ].join('\n'));

    const loader = new SettingsLoader(home + '/.cortex');
    const results = loader.resetAllToDefaults();

    const parsed = parseEnvFile(fs.readFileSync(p, 'utf-8'));
    // API keys preserved
    expect(parsed.DEEPSEEK_API_KEY).toBe('sk-keep');
    expect(parsed.ANTHROPIC_API_KEY).toBe('sk-ant-keep');
    // lever overrides removed
    expect(parsed.CORTEX_ENDTURN_GATE).toBeUndefined();
    expect(parsed.MENTORSHIP_ENABLED).toBeUndefined();
    expect(parsed.YOLO).toBeUndefined();
    // reported the removed levers (not the keys)
    expect(Object.keys(results).sort()).toEqual(['CORTEX_ENDTURN_GATE', 'MENTORSHIP_ENABLED', 'YOLO']);
  });

  it('isUserOverride reflects whether the key is set in the user file', () => {
    const p = getGlobalEnvPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'CORTEX_ENDTURN_GATE=false\n');
    const loader = new SettingsLoader(home + '/.cortex');
    expect(loader.isUserOverride('CORTEX_ENDTURN_GATE')).toBe(true);
    expect(loader.isUserOverride('CORTEX_LIFT_PLAN')).toBe(false);
  });
});
