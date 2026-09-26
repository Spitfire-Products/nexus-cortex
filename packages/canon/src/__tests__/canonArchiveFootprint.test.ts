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
import { canonArchive, dropArchivedDuplicates } from '../canonArchive.js';
import { canonPull, canonPullNative, countArchived } from '../canonPull.js';

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

describe('pulling archived sessions', () => {
  it('canon pull materializes an archived session byte-exact (not on disk, fetched from the store history)', async () => {
    await canonArchive({ store: work, days: 30, push: true });
    expect(fs.existsSync(path.join(work, 'canon/h/old1.jsonl'))).toBe(false);
    expect(countArchived(work, 'canon')).toBe(1);
    const out = path.join(tmp, 'pulled');
    const r = await canonPull({ store: work, session: 'old1', to: out });
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(out, 'old1.jsonl'), 'utf8')).toBe(JSON.stringify({ p: 'canon/h/old1.jsonl' }) + '\n');
  });

  it('canon pull-native materializes an archived native session byte-exact', async () => {
    await canonArchive({ store: work, days: 30, push: true });
    const out = path.join(tmp, 'pulled-native');
    const r = await canonPullNative({ store: work, session: 'old2', to: out });
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(out, 'old2.jsonl'), 'utf8')).toBe(JSON.stringify({ p: 'native/h/old2.jsonl' }) + '\n');
  });

  it('a live session still pulls from the live tree, and an unknown id still fails cleanly', async () => {
    await canonArchive({ store: work, days: 30, push: true });
    const out = path.join(tmp, 'pulled-live');
    expect((await canonPullNative({ store: work, session: 'new', to: out })).code).toBe(0);
    expect((await canonPull({ store: work, session: 'nope-not-here', to: out })).code).toBe(1);
    expect((await canonPullNative({ store: work, session: 'nope-not-here', to: out })).code).toBe(1);
  });
});

/**
 * Live duplicates of archived sessions (mapped 09-26 on the real store): the pre-fix archive run d723f686f (09-20) left
 * 16,357 moved files on disk and the canon-sync 55 s later re-committed them at their old paths — ~6.9k native + ~4.3k
 * canon + ~4.2k projections sessions live AND archived, byte-identical (~1.45 GB of worktree). The archive run now drops
 * a live session whose every file is identical to its archived copy, keeps a session that grew or changed, archives
 * whole sessions only, and never archives non-session files (capability artifacts, captured memory, index docs).
 */
describe('live duplicates of archived sessions', () => {
  const write = (store: string, entries: Record<string, string>, msg: string, env: NodeJS.ProcessEnv = {}) => {
    for (const [p, body] of Object.entries(entries)) {
      fs.mkdirSync(path.join(store, path.dirname(p)), { recursive: true });
      fs.writeFileSync(path.join(store, p), body);
    }
    g(store, ['add', '-A']);
    g(store, ['commit', '-qm', msg], env);
  };
  const headTree = (store: string) => g(store, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(Boolean);
  const body = (p: string) => JSON.stringify({ p }) + '\n';

  it('drops live copies re-added byte-identical after an archive run (the 09-20 re-add), with no third copy', async () => {
    await canonArchive({ store: work, days: 30, push: true });
    // What the 09-20 sync did: re-commit the leftovers at their old paths (recent commit date).
    write(work, { 'native/h/old1.jsonl': body('native/h/old1.jsonl'), 'native/h/old2.jsonl': body('native/h/old2.jsonl'),
      'canon/h/old1.jsonl': body('canon/h/old1.jsonl') }, 're-add');
    expect(await canonArchive({ store: work, days: 30, push: true })).toBe(0);
    expect(files(work)).toEqual(['HARNESSES.json', 'native/h/new.jsonl']);
    expect(g(work, ['status', '--porcelain']).trim()).toBe('');
    const tree = headTree(work);
    expect(tree).not.toContain('native/h/old1.jsonl');
    expect(tree).not.toContain('canon/h/old1.jsonl');
    expect(tree.filter((p) => p.startsWith('archive/')).sort()).toEqual([
      'archive/2026-07/canon/h/old1.jsonl', 'archive/2026-07/native/h/old1.jsonl', 'archive/2026-07/native/h/old2.jsonl']);
    // Idempotent: a second run has nothing to do.
    const head = g(work, ['rev-parse', 'HEAD']).trim();
    expect(await canonArchive({ store: work, days: 30, push: false })).toBe(0);
    expect(g(work, ['rev-parse', 'HEAD']).trim()).toBe(head);
  });

  it('keeps a live copy whose bytes differ from the archived one (the session continued)', async () => {
    await canonArchive({ store: work, days: 30, push: true });
    write(work, { 'native/h/old1.jsonl': body('native/h/old1.jsonl') + '{"more":1}\n' }, 'grew');
    expect(await canonArchive({ store: work, days: 30, push: false })).toBe(0);
    expect(fs.readFileSync(path.join(work, 'native/h/old1.jsonl'), 'utf8')).toContain('"more"');
    expect(headTree(work)).toContain('native/h/old1.jsonl');
  });

  it('keeps a grown CHUNKED session whole — identical early part + a new part is not a duplicate', async () => {
    write(work, { 'native/h/big.jsonl.part-0001': 'p1\n' }, 'big-old', OLD);
    await canonArchive({ store: work, days: 30, push: true });
    expect(headTree(work)).toContain('archive/2026-07/native/h/big.jsonl.part-0001');
    write(work, { 'native/h/big.jsonl.part-0001': 'p1\n', 'native/h/big.jsonl.part-0002': 'p2\n' }, 'big-grew');
    expect(await canonArchive({ store: work, days: 30, push: false })).toBe(0);
    expect(files(work)).toEqual(expect.arrayContaining(['native/h/big.jsonl.part-0001', 'native/h/big.jsonl.part-0002']));
  });

  it('archives a session only when ALL its files are old (no split chunked session)', async () => {
    write(work, { 'native/h/split.jsonl.part-0001': 'a\n' }, 'split-old', OLD);
    write(work, { 'native/h/split.jsonl.part-0002': 'b\n' }, 'split-new');
    expect(await canonArchive({ store: work, days: 30, push: false })).toBe(0);
    const tree = headTree(work);
    expect(tree).toContain('native/h/split.jsonl.part-0001');
    expect(tree).toContain('native/h/split.jsonl.part-0002');
    expect(tree.some((p) => p.includes('split.jsonl'))).toBe(true);
    expect(tree.some((p) => p.startsWith('archive/') && p.includes('split.jsonl'))).toBe(false);
  });

  it('never archives non-session files: capability artifacts, captured memory, index docs', async () => {
    write(work, { 'canon/artifacts/skill/x.json': '{}', 'native/claude-code/proj/memory/m.md': 'm\n',
      'native/SKIPPED.md': '# skipped\n', 'canon/MAPPING.md': '# map\n' }, 'scaffold-old', OLD);
    expect(await canonArchive({ store: work, days: 30, push: false })).toBe(0);
    const tree = headTree(work);
    for (const p of ['canon/artifacts/skill/x.json', 'native/claude-code/proj/memory/m.md', 'native/SKIPPED.md', 'canon/MAPPING.md']) {
      expect(tree).toContain(p);
      expect(tree).not.toContain(`archive/2026-07/${p}`);
    }
  });
});

describe('sync never re-adds archived sessions', () => {
  it('dropArchivedDuplicates removes untracked byte-identical copies, keeps a grown one and every tracked file', async () => {
    await canonArchive({ store: work, days: 30, push: true });
    // What the browser fold-in / a re-staged copy does: the archived files reappear on disk, untracked.
    fs.mkdirSync(path.join(work, 'native/h'), { recursive: true });
    fs.mkdirSync(path.join(work, 'canon/h'), { recursive: true });
    fs.writeFileSync(path.join(work, 'native/h/old1.jsonl'), JSON.stringify({ p: 'native/h/old1.jsonl' }) + '\n'); // identical
    fs.writeFileSync(path.join(work, 'canon/h/old1.jsonl'), JSON.stringify({ p: 'canon/h/old1.jsonl' }) + '\n'); // identical
    // The browser fold-in path STAGES what it restores (git checkout <tree> -- <path>).
    fs.writeFileSync(path.join(work, 'native/h/old2.jsonl'), JSON.stringify({ p: 'native/h/old2.jsonl' }) + '\n');
    g(work, ['add', '--', 'native/h/old2.jsonl']);
    expect(dropArchivedDuplicates(work, 'test')).toBe(3);
    expect(fs.existsSync(path.join(work, 'native/h/old2.jsonl'))).toBe(false);
    expect(g(work, ['status', '--porcelain']).trim()).toBe('');
    fs.writeFileSync(path.join(work, 'native/h/old2.jsonl'), 'GREW\n'); // differs → a live session again
    expect(dropArchivedDuplicates(work, 'test')).toBe(0);
    expect(fs.existsSync(path.join(work, 'native/h/old1.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(work, 'canon/h/old1.jsonl'))).toBe(false);
    expect(fs.readFileSync(path.join(work, 'native/h/old2.jsonl'), 'utf8')).toBe('GREW\n');
    expect(fs.readFileSync(path.join(work, 'native/h/new.jsonl'), 'utf8')).toBe('{"new":1}\n'); // tracked, untouched
  });
});
