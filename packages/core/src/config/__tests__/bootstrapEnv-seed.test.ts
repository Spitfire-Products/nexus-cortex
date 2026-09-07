/**
 * bootstrapEnv FIRST-ACTIVATION SEED + read-live default layer (2026-09 model).
 *
 * NEW behavior: seed ONLY a KEYS-ONLY `~/.cortex/.env` (secret slots, no levers) — never
 * a `packageRoot/.env` copy. Harness defaults are READ LIVE from the shipped
 * `.env.defaults`, loaded as the LOWEST-precedence base file, so a package upgrade
 * propagates new defaults with nothing to regenerate and no keys to re-enter. `os.homedir`
 * is mocked so `~/.cortex` resolves into a temp dir (the real one is never touched).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

// Redirect os.homedir() (used by getGlobalConfigDir) into a per-test temp dir.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => process.env.__BSE_HOME__ || actual.homedir() };
});

import { bootstrapEnv, getGlobalEnvPath } from '../SettingsLoader.js';

describe('bootstrapEnv seed + read-live defaults', () => {
  let home: string;
  let pkgRoot: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(tmpdir(), 'bse-home-'));
    pkgRoot = fs.mkdtempSync(path.join(tmpdir(), 'bse-pkg-'));
    process.env.__BSE_HOME__ = home;
    // packageRoot/.env.defaults is discovered FIRST by resolveDefaultsEnvPath.
    fs.writeFileSync(path.join(pkgRoot, '.env.defaults'), 'SEED_TEST_VAR=from-defaults\n');
    delete process.env.SEED_TEST_VAR;
  });
  afterEach(() => {
    delete process.env.__BSE_HOME__;
    delete process.env.SEED_TEST_VAR;
    for (const d of [home, pkgRoot]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('seeds a KEYS-ONLY ~/.cortex/.env (secret slots, no levers) and NO packageRoot/.env', () => {
    const globalEnv = getGlobalEnvPath();
    const pkgEnv = path.join(pkgRoot, '.env');
    expect(fs.existsSync(globalEnv)).toBe(false);

    bootstrapEnv(pkgRoot);

    expect(fs.existsSync(globalEnv)).toBe(true);
    expect(fs.existsSync(pkgEnv)).toBe(false); // the install-dir .env copy is gone in the new model
    const stub = fs.readFileSync(globalEnv, 'utf-8');
    expect(stub).toContain('DEEPSEEK_API_KEY=');       // a secret key slot to fill
    expect(stub).not.toContain('CORTEX_ENDTURN_GATE');  // NO levers frozen into the user file
  });

  it('reads the shipped .env.defaults into process.env as the lowest layer (read-live)', () => {
    bootstrapEnv(pkgRoot);
    expect(process.env.SEED_TEST_VAR).toBe('from-defaults');
  });

  it('a packageRoot/.env value OVERRIDES the shipped .env.defaults', () => {
    fs.writeFileSync(path.join(pkgRoot, '.env'), 'SEED_TEST_VAR=from-user\n');
    bootstrapEnv(pkgRoot);
    expect(process.env.SEED_TEST_VAR).toBe('from-user');
  });

  it('a real injected env value wins over .env.defaults (first-wins over base files)', () => {
    process.env.SEED_TEST_VAR = 'from-shell';
    bootstrapEnv(pkgRoot);
    expect(process.env.SEED_TEST_VAR).toBe('from-shell');
  });

  it('does NOT clobber an existing (user-edited) global .env', () => {
    const globalEnv = getGlobalEnvPath();
    fs.mkdirSync(path.dirname(globalEnv), { recursive: true });
    fs.writeFileSync(globalEnv, '# mine\nDEEPSEEK_API_KEY=sk-mine\n');
    bootstrapEnv(pkgRoot);
    expect(fs.readFileSync(globalEnv, 'utf-8')).toBe('# mine\nDEEPSEEK_API_KEY=sk-mine\n');
  });

  it('regenerates the global keys stub when it has been deleted', () => {
    const globalEnv = getGlobalEnvPath();
    bootstrapEnv(pkgRoot);
    fs.rmSync(globalEnv);
    bootstrapEnv(pkgRoot);
    expect(fs.existsSync(globalEnv)).toBe(true);
    expect(fs.readFileSync(globalEnv, 'utf-8')).toContain('DEEPSEEK_API_KEY=');
  });

  it('no-ops safely when no packageRoot is available', () => {
    expect(() => bootstrapEnv(undefined)).not.toThrow();
  });
});
