/**
 * An archive run in a PARTIAL clone must not download archived blobs (2026-11-15: plain `git write-tree` checked every indexed object
 * and lazily fetched each archived session — ~1 GB on the repl in one run). Round 1 archives old files in a full clone and pushes; a
 * fresh partial clone (file:// so --filter applies) then has archive/ blobs MISSING; round 2 archives another old file there. After it the
 * round-1 archive blobs must still be missing, and the pushed tree must hold every path.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { atomicClone } from '../canonRepo.js';
import { canonArchive } from '../canonArchive.js';

const g = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
const OLD = { GIT_AUTHOR_DATE: '2026-07-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-07-01T00:00:00Z' };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-archive-nolazy-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const local = (store: string, sha: string) => { try { g(store, ['cat-file', '-e', sha], { GIT_NO_LAZY_FETCH: '1' }); return true; } catch { return false; } };

describe('canonArchive in a partial clone', () => {
  it('does not fetch archived blobs; the pushed tree is complete', async () => {
    const bare = path.join(tmp, 'remote.git'); const work = path.join(tmp, 'work');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    g(bare, ['config', 'uploadpack.allowFilter', 'true']); g(bare, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
    execFileSync('git', ['clone', '-q', bare, work], { stdio: 'ignore' });
    g(work, ['config', 'user.email', 't@t']); g(work, ['config', 'user.name', 't']); g(work, ['checkout', '-q', '-b', 'main']);
    fs.writeFileSync(path.join(work, 'HARNESSES.json'), '{}');
    fs.mkdirSync(path.join(work, 'native/h'), { recursive: true });
    for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(work, `native/h/old${i}.jsonl`), JSON.stringify({ i, pad: 'x'.repeat(5000) }) + '\n');
    g(work, ['add', '-A']); g(work, ['commit', '-qm', 'old'], OLD);
    g(work, ['push', '-q', 'origin', 'main']);
    expect(await canonArchive({ store: work, days: 30, push: true })).toBe(0);              // round 1 (full clone) → archive/ on the remote

    const fresh = path.join(tmp, 'fresh');
    atomicClone(`file://${bare}`, fresh, 'test');
    const archived = g(fresh, ['ls-tree', '-r', '--format=%(objectname) %(path)', 'HEAD', '--', 'archive']).trim().split('\n').filter(Boolean);
    expect(archived.length).toBe(4);
    expect(archived.filter(([sha]) => local(fresh, sha.split(' ')[0]!))).toEqual([]);    // the partial clone holds none of them

    // round 2: another old file arrives (pushed from the full clone), the partial store archives it
    fs.mkdirSync(path.join(work, 'native/h'), { recursive: true });   // round 1 moved the folder's files to archive/
    fs.writeFileSync(path.join(work, 'native/h/later.jsonl'), '{"later":1}\n');
    g(work, ['add', '-A']); g(work, ['commit', '-qm', 'later'], OLD); g(work, ['push', '-q', 'origin', 'main']);
    g(fresh, ['config', 'user.email', 't@t']); g(fresh, ['config', 'user.name', 't']);
    g(fresh, ['pull', '-q', 'origin', 'main']);
    expect(await canonArchive({ store: fresh, days: 30, push: true })).toBe(0);

    for (const line of archived) expect(local(fresh, line.split(' ')[0]!)).toBe(false);   // still not downloaded
    const pushed = g(bare, ['ls-tree', '-r', '--name-only', 'main']).split('\n').filter(Boolean);
    expect(pushed.filter((p) => p.startsWith('archive/')).length).toBe(5);
    expect(pushed.some((p) => p.startsWith('native/h/'))).toBe(false);
    expect(g(bare, ['fsck', '--no-dangling']).trim()).toBe('');
  });
});
