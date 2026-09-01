/**
 * bootstrapEnv FIRST-ACTIVATION SEED: on EVERY startup, seed BOTH the global
 * `~/.cortex/.env` AND a user-findable `packageRoot/.env` from the shipped
 * `.env.example` — each independently created only when MISSING (regenerate a deleted
 * one; never clobber an existing/edited one). `os.homedir` is mocked so `~/.cortex`
 * resolves into a temp dir (the real one is never touched), and a MINIMAL `.env.example`
 * keeps process.env clean.
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

describe('bootstrapEnv first-activation seed', () => {
  let home: string;
  let pkgRoot: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(tmpdir(), 'bse-home-'));
    pkgRoot = fs.mkdtempSync(path.join(tmpdir(), 'bse-pkg-'));
    process.env.__BSE_HOME__ = home;
    // packageRoot/.env.example is discovered FIRST (before any cwd fallback), so no chdir needed.
    fs.writeFileSync(path.join(pkgRoot, '.env.example'), 'SEED_TEST_VAR=hello\n');
    delete process.env.SEED_TEST_VAR;
  });
  afterEach(() => {
    delete process.env.__BSE_HOME__;
    delete process.env.SEED_TEST_VAR;
    for (const d of [home, pkgRoot]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('creates BOTH ~/.cortex/.env and packageRoot/.env from .env.example on first activation', () => {
    const globalEnv = getGlobalEnvPath();
    const pkgEnv = path.join(pkgRoot, '.env');
    expect(fs.existsSync(globalEnv)).toBe(false);
    expect(fs.existsSync(pkgEnv)).toBe(false);

    bootstrapEnv(pkgRoot);

    expect(fs.existsSync(globalEnv)).toBe(true);
    expect(fs.existsSync(pkgEnv)).toBe(true);
    expect(fs.readFileSync(globalEnv, 'utf-8')).toBe('SEED_TEST_VAR=hello\n');
    expect(fs.readFileSync(pkgEnv, 'utf-8')).toBe('SEED_TEST_VAR=hello\n');
  });

  it('does NOT clobber an existing (user-edited) file', () => {
    const pkgEnv = path.join(pkgRoot, '.env');
    fs.writeFileSync(pkgEnv, 'SEED_TEST_VAR=user-edited\n');
    bootstrapEnv(pkgRoot);
    expect(fs.readFileSync(pkgEnv, 'utf-8')).toBe('SEED_TEST_VAR=user-edited\n');
  });

  it('regenerates ONLY the missing file, leaving the existing one untouched', () => {
    const globalEnv = getGlobalEnvPath();
    const pkgEnv = path.join(pkgRoot, '.env');
    bootstrapEnv(pkgRoot);                          // both now exist
    fs.writeFileSync(globalEnv, 'SEED_TEST_VAR=kept\n'); // user edits the global one
    fs.rmSync(pkgEnv);                              // delete only the package one
    bootstrapEnv(pkgRoot);                          // next startup
    expect(fs.readFileSync(pkgEnv, 'utf-8')).toBe('SEED_TEST_VAR=hello\n');   // regenerated
    expect(fs.readFileSync(globalEnv, 'utf-8')).toBe('SEED_TEST_VAR=kept\n'); // untouched
  });

  it('no-ops safely when no packageRoot / no .env.example is available', () => {
    expect(() => bootstrapEnv(undefined)).not.toThrow();
  });

  it("🔴 FALLS BACK to core's OWN shipped template when the calling package has none (server-direct boots)", () => {
    // The server package historically shipped no .env.example: bootstrapEnv(serverRoot)
    // found no template and silently skipped seeding — bench/task containers (which
    // boot cortex-server directly, never the CLI) ran with NO .env at all. The fix:
    // core ships the template itself and is a dependency of every entry point, so a
    // caller with no template of its own still seeds from core's copy.
    const bareRoot = fs.mkdtempSync(path.join(tmpdir(), 'bse-bare-')); // simulates the server pkg: NO .env.example
    try {
      const globalEnv = getGlobalEnvPath();
      expect(fs.existsSync(globalEnv)).toBe(false);
      bootstrapEnv(bareRoot);
      // Seeded from core's own template (packages/core/.env.example, build-synced from
      // the repo root) — the real canonical content, so assert a known canonical key.
      expect(fs.existsSync(globalEnv)).toBe(true);
      const seeded = fs.readFileSync(globalEnv, 'utf-8');
      expect(seeded).toContain('ENABLE_DEFERRED_TOOL_LOADING=true');
      // The bare package root also gets its user-findable copy.
      expect(fs.existsSync(path.join(bareRoot, '.env'))).toBe(true);
    } finally {
      fs.rmSync(bareRoot, { recursive: true, force: true });
    }
  });
});
