/**
 * Scoped sync (2026-09-01): sparse cone-mode sync-only stores.
 * E2E against a LOCAL bare fixture repo (no network): a store scoped to one
 * harness leg materializes ~that leg only, syncs/pushes correctly, never
 * touches the other legs, and full-surface verbs refuse it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { atomicClone, isScopedStore, sparseAdd, requireFullSurfaceStore } from '../canonRepo.js';
import { canonSync } from '../canonSync.js';

const g = (cwd: string, args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

let tmp: string;
let bare: string;      // the "remote"
let seedWork: string;  // used to seed the remote

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-scope-'));
  bare = path.join(tmp, 'remote.git');
  seedWork = path.join(tmp, 'seed');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['init', '-q', '-b', 'main', seedWork]);
  g(seedWork, ['config', 'user.email', 't@t']);
  g(seedWork, ['config', 'user.name', 't']);
  // Fixture surface: root config + two native legs + a canon leg.
  fs.writeFileSync(path.join(seedWork, 'HARNESSES.json'), JSON.stringify({
    harnesses: {
      testh: { exts: ['.jsonl'], roots: ['~/sessions-testh'] },
      otherh: { exts: ['.jsonl'], roots: ['~/sessions-otherh-absent'] },
    },
  }));
  for (const p of ['native/testh/seed.jsonl', 'native/otherh/other.jsonl', 'canon/testh/c.jsonl']) {
    fs.mkdirSync(path.join(seedWork, path.dirname(p)), { recursive: true });
    fs.writeFileSync(path.join(seedWork, p), JSON.stringify({ seed: p }) + '\n');
  }
  fs.writeFileSync(path.join(seedWork, 'native', 'SKIPPED.md'), '# skip log\n');
  g(seedWork, ['add', '-A']);
  g(seedWork, ['commit', '-q', '-m', 'seed']);
  g(seedWork, ['push', '-q', bare, 'main']);
});

afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('atomicClone scoped mode', () => {
  it('scoped clone materializes the scoped leg + root files, NOT other legs', () => {
    const store = path.join(tmp, 'store-scoped');
    atomicClone(bare, store, 'test', ['native/testh']);
    expect(fs.existsSync(path.join(store, 'HARNESSES.json'))).toBe(true);          // root file
    expect(fs.existsSync(path.join(store, 'native', 'SKIPPED.md'))).toBe(true);    // cone-ancestor file
    expect(fs.existsSync(path.join(store, 'native', 'testh', 'seed.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(store, 'native', 'otherh'))).toBe(false);       // out of cone
    expect(fs.existsSync(path.join(store, 'canon'))).toBe(false);                  // out of cone
    expect(isScopedStore(store)).toBe(true);
  });

  it('unscoped clone is full-surface and not scoped', () => {
    const store = path.join(tmp, 'store-full');
    atomicClone(bare, store, 'test');
    expect(fs.existsSync(path.join(store, 'native', 'otherh', 'other.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(store, 'canon', 'testh', 'c.jsonl'))).toBe(true);
    expect(isScopedStore(store)).toBe(false);
    expect(() => requireFullSurfaceStore(store, 'test')).not.toThrow();
  });

  it('commit+push from a scoped store lands without touching out-of-cone legs', () => {
    const store = path.join(tmp, 'store-push');
    atomicClone(bare, store, 'test', ['native/testh']);
    g(store, ['config', 'user.email', 't@t']);
    g(store, ['config', 'user.name', 't']);
    fs.writeFileSync(path.join(store, 'native', 'testh', 'new.jsonl'), '{"x":1}\n');
    g(store, ['add', '-A']);
    g(store, ['commit', '-q', '-m', 'scoped add']);
    g(store, ['push', '-q', 'origin', 'main']);
    // Verify on a FRESH full clone of the remote: new file present, other legs intact.
    const verify = path.join(tmp, 'store-verify');
    atomicClone(bare, verify, 'test');
    expect(fs.existsSync(path.join(verify, 'native', 'testh', 'new.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(verify, 'native', 'otherh', 'other.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(verify, 'canon', 'testh', 'c.jsonl'))).toBe(true);
  });

  it('sparseAdd widens the cone idempotently', () => {
    const store = path.join(tmp, 'store-widen');
    atomicClone(bare, store, 'test', ['native/testh']);
    expect(fs.existsSync(path.join(store, 'native', 'otherh'))).toBe(false);
    sparseAdd(store, ['native/otherh'], 'test');
    expect(fs.existsSync(path.join(store, 'native', 'otherh', 'other.jsonl'))).toBe(true);
    sparseAdd(store, ['native/otherh'], 'test'); // idempotent
    expect(isScopedStore(store)).toBe(true);
  });

  it('requireFullSurfaceStore refuses a scoped store with the remedy', () => {
    const store = path.join(tmp, 'store-refuse');
    atomicClone(bare, store, 'test', ['native/testh']);
    expect(() => requireFullSurfaceStore(store, 'canon-translate')).toThrow(/SCOPED.*sparse/);
  });
});

describe('canonSync scope=auto end-to-end', () => {
  it('clones root-only, discovers the locally-present harness, syncs ONLY its leg, pushes', async () => {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(path.join(home, 'sessions-testh'), { recursive: true });
    fs.writeFileSync(path.join(home, 'sessions-testh', 's1.jsonl'), JSON.stringify({ hello: 1 }) + '\n');
    // otherh's root deliberately absent -> auto-scope must exclude it.
    const store = path.join(tmp, 'store-auto');
    const r = await canonSync({ store, home, repoUrl: bare, scope: 'auto' });
    expect(isScopedStore(store)).toBe(true);
    expect(fs.existsSync(path.join(store, 'native', 'testh', 's1.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(store, 'canon'))).toBe(false);       // never materialized
    expect(r.copied).toBeGreaterThanOrEqual(1);
    expect(r.pushed).toBe(true);
    // Remote verify: the synced file landed; untouched legs intact.
    const verify = path.join(tmp, 'store-auto-verify');
    atomicClone(bare, verify, 'test');
    expect(fs.existsSync(path.join(verify, 'native', 'testh', 's1.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(verify, 'native', 'otherh', 'other.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(verify, 'canon', 'testh', 'c.jsonl'))).toBe(true);
  });
});
