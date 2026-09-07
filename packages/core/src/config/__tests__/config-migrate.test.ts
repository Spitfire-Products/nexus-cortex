/**
 * One-time migration: collapse an EXISTING user's frozen full ~/.cortex/.env snapshot
 * (the old full-copy seed) back to sparse — remove lever lines matching a default (new
 * shipped OR old hardcoded floor) so they inherit reson, keep API keys + real divergences.
 * os.homedir mocked into a temp dir. Shipped defaults come from the real .env.defaults.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => process.env.__MG_HOME__ || actual.homedir() };
});

import {
  migrateGlobalConfigToSparse, getGlobalEnvPath, parseEnvFile,
} from '../SettingsLoader.js';
import { DEFAULT_SETTINGS } from '../SettingsSchema.js';

function writeGlobalEnv(content: string) {
  const p = getGlobalEnvPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

describe('migrateGlobalConfigToSparse', () => {
  let home: string;
  beforeEach(() => { home = fs.mkdtempSync(path.join(tmpdir(), 'mg-home-')); process.env.__MG_HOME__ = home; });
  afterEach(() => { delete process.env.__MG_HOME__; fs.rmSync(home, { recursive: true, force: true }); });

  it('collapses a full snapshot: removes default-matching levers, keeps keys + divergences', () => {
    // Full snapshot = every DEFAULT_SETTINGS lever at its floor value + one custom + a key.
    const snap: Record<string, string> = { ...(DEFAULT_SETTINGS as Record<string, string>) };
    snap.TOOL_BUDGET_SOFT = '999';        // a genuine user divergence (≠ floor 400, ≠ shipped)
    snap.DEEPSEEK_API_KEY = 'sk-keep';    // a secret — must survive
    const p = writeGlobalEnv(Object.entries(snap).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');

    const res = migrateGlobalConfigToSparse();
    expect(res.migrated).toBe(true);
    expect(res.removed).toBeGreaterThan(15);

    const parsed = parseEnvFile(fs.readFileSync(p, 'utf-8'));
    expect(parsed.DEEPSEEK_API_KEY).toBe('sk-keep');       // key preserved
    expect(parsed.TOOL_BUDGET_SOFT).toBe('999');           // divergence preserved
    // GATE was written at the OLD floor ('false'); it matches DEFAULT_SETTINGS → removed →
    // now inherits the shipped .env.defaults ('true'). This is the reson propagation.
    expect(parsed.CORTEX_ENDTURN_GATE).toBeUndefined();
    // backup + marker written
    expect(fs.existsSync(p + '.pre-migrate-backup')).toBe(true);
    expect(fs.existsSync(path.join(home, '.cortex', '.env-migrated'))).toBe(true);
  });

  it('is a one-time no-op once the marker exists', () => {
    writeGlobalEnv(Object.entries(DEFAULT_SETTINGS as Record<string, string>).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
    const first = migrateGlobalConfigToSparse();
    expect(first.migrated).toBe(true);
    const second = migrateGlobalConfigToSparse();
    expect(second.migrated).toBe(false);
    expect(second.removed).toBe(0);
  });

  it('skips a SPARSE file (already curated) without removing anything', () => {
    const p = writeGlobalEnv('DEEPSEEK_API_KEY=sk-keep\nCORTEX_ENDTURN_GATE=false\n');
    const res = migrateGlobalConfigToSparse();
    expect(res.migrated).toBe(false);
    const parsed = parseEnvFile(fs.readFileSync(p, 'utf-8'));
    expect(parsed.CORTEX_ENDTURN_GATE).toBe('false');   // untouched
    expect(parsed.DEEPSEEK_API_KEY).toBe('sk-keep');
    // marker still written so it doesn't re-check every boot
    expect(fs.existsSync(path.join(home, '.cortex', '.env-migrated'))).toBe(true);
  });
});
