/**
 * repackAllIfNeeded (2026-11-18): size+interval-gated FULL `repack -a -d` that reclaims the duplicate promisor packs a
 * partial clone accumulates on `pull --rebase` lazy over-fetch (store ballooned 1.9 → 6.2 GB in ~4 h, 11-18). Uses a REAL
 * tiny git repo (the function sets GIT_NO_LAZY_FETCH itself, so it cannot go through the fake-git closure the loose-repack
 * test uses). Verifies: it consolidates packs when gated open; honours the size threshold, the min-interval stamp and the
 * disable switch; and never throws on a non-repo.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { repackAllIfNeeded } from '../canonRepo.js';

// INCOMPRESSIBLE content, so size-pack is a reliable ~hundreds of KB (highly-compressible filler packs to ~0 and can't
// clear even a tiny threshold). A tiny positive threshold (0.001 MB) opens the gate — `Number('0')||2500` treats 0 as unset
// (the codebase `|| default` convention; 0 as "always" is a production foot-gun), so the open gate uses 0.001, not 0.
const TINY_MB = '0.001';
const blob = () => randomBytes(300 * 1024);

const g = (store: string, args: string[]) =>
  execFileSync('git', ['-C', store, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
const packs = (store: string) => Number((g(store, ['count-objects', '-v']).match(/^packs: (\d+)/m) ?? [])[1] ?? 0);

/** A repo carrying ≥2 packs (so there is something to consolidate), like a store that pulled duplicate promisor packs. */
function twoPackRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-repack-all-'));
  g(dir, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'a.bin'), blob());
  g(dir, ['add', '-A']); g(dir, ['commit', '-q', '-m', 'a']);
  g(dir, ['repack', '-a', '-d', '-q']);                       // pack #1
  fs.writeFileSync(path.join(dir, 'b.bin'), blob());
  g(dir, ['add', '-A']); g(dir, ['commit', '-q', '-m', 'b']);
  g(dir, ['repack', '-q']);                                   // pack #2 (new objects, keeps #1)
  return dir;
}

const ENV_KEYS = ['CANON_REPACK_ALL_MAX_PACKS', 'CANON_REPACK_ALL_MB', 'CANON_REPACK_ALL_MIN_INTERVAL_MS', 'CANON_REPACK_ALL_DISABLE'] as const;
let saved: Record<string, string | undefined>;
const created: string[] = [];
beforeEach(() => { saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); });
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
  for (const d of created.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
/** The gate keys on PACK COUNT: the twoPackRepo has 2 packs, so open the gate at maxPacks=2 (real stores use the default 4). */
const openGate = () => {
  process.env.CANON_REPACK_ALL_MAX_PACKS = '2';       // 2 packs qualifies (>= maxPacks)
  process.env.CANON_REPACK_ALL_MB = TINY_MB;          // any real pack size clears the floor
  process.env.CANON_REPACK_ALL_MIN_INTERVAL_MS = '0'; // no interval hold
};

describe('repackAllIfNeeded', () => {
  it('consolidates packs when the pack-count gate is open and no recent repack', () => {
    const dir = twoPackRepo(); created.push(dir);
    expect(packs(dir)).toBeGreaterThanOrEqual(2);
    openGate();
    expect(repackAllIfNeeded(dir, 't')).toBe(true);
    expect(packs(dir)).toBeLessThan(2);                 // all packs consolidated into one
    expect(fs.existsSync(path.join(dir, '.git', 'canon-last-full-repack'))).toBe(true); // stamp written
  });

  it('skips below the pack-count gate (few packs) and below the size floor', () => {
    const dir = twoPackRepo(); created.push(dir);
    // pack-count gate: 2 packs < 99 → skip even with the size floor open
    process.env.CANON_REPACK_ALL_MAX_PACKS = '99';
    process.env.CANON_REPACK_ALL_MB = TINY_MB;
    process.env.CANON_REPACK_ALL_MIN_INTERVAL_MS = '0';
    expect(repackAllIfNeeded(dir, 't')).toBe(false);
    // size floor: pack count qualifies but the floor is unreachable → skip
    process.env.CANON_REPACK_ALL_MAX_PACKS = '2';
    process.env.CANON_REPACK_ALL_MB = '999999';
    expect(repackAllIfNeeded(dir, 't')).toBe(false);
    expect(packs(dir)).toBeGreaterThanOrEqual(2);       // untouched by either skip
  });

  it('honours the min-interval stamp (no second repack right after one)', () => {
    const dir = twoPackRepo(); created.push(dir);
    openGate();
    expect(repackAllIfNeeded(dir, 't')).toBe(true);     // first run stamps
    // re-fragment back to >=2 packs, then demand a long interval: the fresh stamp must suppress the repack
    fs.writeFileSync(path.join(dir, 'c.bin'), blob());
    g(dir, ['add', '-A']); g(dir, ['commit', '-q', '-m', 'c']); g(dir, ['repack', '-q']);
    process.env.CANON_REPACK_ALL_MIN_INTERVAL_MS = String(6 * 3600_000);
    expect(repackAllIfNeeded(dir, 't')).toBe(false);
  });

  it('is disabled by CANON_REPACK_ALL_DISABLE=1', () => {
    const dir = twoPackRepo(); created.push(dir);
    openGate();
    process.env.CANON_REPACK_ALL_DISABLE = '1';
    expect(repackAllIfNeeded(dir, 't')).toBe(false);
    expect(packs(dir)).toBeGreaterThanOrEqual(2);
  });

  it('never throws on a path that is not a git store', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-repack-none-')); created.push(dir);
    expect(() => repackAllIfNeeded(dir, 't')).not.toThrow();
    expect(repackAllIfNeeded(dir, 't')).toBe(false);
  });
});
