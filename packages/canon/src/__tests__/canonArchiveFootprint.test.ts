/**
 * Archive footprint (2026-09-26): the hot/archive split must actually SHRINK the local store and never break the
 * pipeline. Regression tests for the four defects reproduced on 09-26 (a throwaway repo + the live /tmp store):
 *   1. an archive run left every moved file ON DISK as an untracked file (nothing freed; next `git add -A` re-added them);
 *   2. the archive exclusion made isScopedStore() true → translate/graph/artifacts refused the store;
 *   3. a fresh atomicClone re-materialized archive/ (no exclusion on clone);
 *   4. a no-move archive run never applied the exclusion to such a clone.
 * E2E against a LOCAL bare fixture repo (no network).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { atomicClone, isScopedStore, requireFullSurfaceStore, hasArchiveExclusion } from '../canonRepo.js';
import { canonArchive } from '../canonArchive.js';

const g = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });

const OLD = { GIT_AUTHOR_DATE: '2026-07-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-07-01T00:00:00Z' };
const files = (dir: string) => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      e.isDirectory() ? walk(p) : out.push(path.relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
};

let tmp: string;
let bare: string;
let work: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-archive-'));
  bare = path.join(tmp, 'remote.git');
  work = path.join(tmp, 'store');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['clone', '-q', bare, work], { stdio: ['ignore', 'pipe', 'pipe'] });
  g(work, ['config', 'user.email', 't@t']);
  g(work, ['config', 'user.name', 't']);
  g(work, ['checkout', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(work, 'HARNESSES.json'), '{}');
  for (const p of ['native/h/old1.jsonl', 'native/h/old2.jsonl', 'canon/h/old1.jsonl']) {
    fs.mkdirSync(path.join(work, path.dirname(p)), { recursive: true });
    fs.writeFileSync(path.join(work, p), JSON.stringify({ p }) + '\n');
  }
  g(work, ['add', '-A']);
  g(work, ['commit', '-qm', 'old'], OLD);
  fs.writeFileSync(path.join(work, 'native/h/new.jsonl'), '{"new":1}\n');
  g(work, ['add', '-A']);
  g(work, ['commit', '-qm', 'new']);
  g(work, ['push', '-q', 'origin', 'main']);
});

afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('canonArchive local footprint', () => {
  it('removes the moved files from disk, leaves a clean worktree, and nothing for `git add -A` to re-add', async () => {
    expect(await canonArchive({ store: work, days: 30, push: true })).toBe(0);
    expect(files(work)).toEqual(['HARNESSES.json', 'native/h/new.jsonl']);
    expect(g(work, ['status', '--porcelain']).trim()).toBe('');
    g(work, ['add', '-A']);
    expect(g(work, ['status', '--porcelain']).trim()).toBe('');
    // The remote holds the moved files under archive/ (nothing deleted upstream).
    const tree = g(work, ['ls-tree', '-r', '--name-only', 'origin/main']).split('\n').filter(Boolean);
    expect(tree).toContain('archive/2026-07/native/h/old1.jsonl');
    expect(tree).toContain('archive/2026-07/canon/h/old1.jsonl');
  });

  it('the archive exclusion does NOT read as a scoped store — full-surface verbs still run', async () => {
    await canonArchive({ store: work, days: 30, push: true });
    expect(hasArchiveExclusion(work)).toBe(true);
    expect(isScopedStore(work)).toBe(false);
    expect(() => requireFullSurfaceStore(work, 'canon-translate')).not.toThrow();
  });

  it('never touches a file re-written at an archived path (dirty tree → the next run aborts, content kept)', async () => {
    await canonArchive({ store: work, days: 30, push: false });
    fs.mkdirSync(path.join(work, 'native/h'), { recursive: true });
    fs.writeFileSync(path.join(work, 'native/h/old1.jsonl'), 'DIFFERENT\n');
    // A second run has nothing new to move and must not touch the untracked, changed file.
    await expect(canonArchive({ store: work, days: 30, push: false })).resolves.toBe(1); // dirty tree → abort
    expect(fs.readFileSync(path.join(work, 'native/h/old1.jsonl'), 'utf8')).toBe('DIFFERENT\n');
  });
});

describe('clones never materialize archive/', () => {
  it('a fresh full-surface atomicClone excludes archive/ and is not scoped', async () => {
    await canonArchive({ store: work, days: 30, push: true });
    const fresh = path.join(tmp, 'fresh');
    atomicClone(bare, fresh, 'test');
    expect(files(fresh)).toEqual(['HARNESSES.json', 'native/h/new.jsonl']);
    expect(hasArchiveExclusion(fresh)).toBe(true);
    expect(isScopedStore(fresh)).toBe(false);
    expect(() => requireFullSurfaceStore(fresh, 'canon-graph')).not.toThrow();
  });

  it('a no-move archive run applies the exclusion to a store that materialized archive/ (old clone path)', async () => {
    await canonArchive({ store: work, days: 30, push: true });
    const legacy = path.join(tmp, 'legacy');
    execFileSync('git', ['clone', '-q', bare, legacy], { stdio: ['ignore', 'pipe', 'pipe'] }); // plain full clone
    expect(files(legacy)).toContain('archive/2026-07/native/h/old1.jsonl');
    expect(await canonArchive({ store: legacy, days: 30, push: false })).toBe(0);
    expect(files(legacy)).toEqual(['HARNESSES.json', 'native/h/new.jsonl']);
    expect(g(legacy, ['status', '--porcelain']).trim()).toBe('');
  });

  it('a MOVE run on a store that already materialized archive/ removes archive/ from disk too (live 09-26 case)', async () => {
    await canonArchive({ store: work, days: 30, push: true });
    const legacy = path.join(tmp, 'legacy2');
    execFileSync('git', ['clone', '-q', bare, legacy], { stdio: ['ignore', 'pipe', 'pipe'] }); // full clone → archive/ on disk
    g(legacy, ['config', 'user.email', 't@t']);
    g(legacy, ['config', 'user.name', 't']);
    // a NEW old-dated file so this run has something to move (the combination the no-move test did not cover)
    fs.writeFileSync(path.join(legacy, 'native/h/old3.jsonl'), '{"p":3}\n');
    g(legacy, ['add', '-A']);
    g(legacy, ['commit', '-qm', 'old3'], OLD);
    expect(files(legacy)).toContain('archive/2026-07/native/h/old1.jsonl');
    expect(await canonArchive({ store: legacy, days: 30, push: false })).toBe(0);
    expect(files(legacy)).toEqual(['HARNESSES.json', 'native/h/new.jsonl']);
    expect(g(legacy, ['status', '--porcelain']).trim()).toBe('');
  });

  it('a store flagged as excluded but still holding archive/ on disk gets cleaned by a no-move run (live 09-26 state)', async () => {
    await canonArchive({ store: work, days: 30, push: true });
    const stuck = path.join(tmp, 'stuck');
    execFileSync('git', ['clone', '-q', bare, stuck], { stdio: ['ignore', 'pipe', 'pipe'] });
    // Flag the exclusion WITHOUT applying it to the worktree (what the half-failed live run left behind).
    g(stuck, ['config', 'core.sparseCheckout', 'true']);
    g(stuck, ['config', 'core.sparseCheckoutCone', 'false']);
    fs.writeFileSync(path.join(stuck, '.git', 'info', 'sparse-checkout'), '/*\n!archive/\n');
    expect(files(stuck)).toContain('archive/2026-07/native/h/old1.jsonl');
    expect(await canonArchive({ store: stuck, days: 30, push: false })).toBe(0);
    expect(files(stuck)).toEqual(['HARNESSES.json', 'native/h/new.jsonl']);
  });

  it('a scoped (cone) clone is still scoped', () => {
    const scoped = path.join(tmp, 'scoped');
    atomicClone(bare, scoped, 'test', ['native/h']);
    expect(isScopedStore(scoped)).toBe(true);
    expect(hasArchiveExclusion(scoped)).toBe(false);
  });
});
