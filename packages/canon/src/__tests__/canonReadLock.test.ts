/**
 * A read's store freshen runs under the single-writer lock (2026-11-15: two concurrent read pulls raced on refs/remotes/origin/main and
 * the loser left a 555 MB orphan tmp_pack that filled the disk quota). While another live writer holds the lock the read must NOT pull:
 * it reads the store as it is. The remote is deleted, so a pull that did run would fail the read.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { canonList } from '../canonPull.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-readlock-'));
const BARE = path.join(tmp, 'origin.git');
const STORE = path.join(tmp, 'store');
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('read freshen under the writer lock', () => {
  it('pulls when the lock is free; skips the pull (no error) while a live writer holds it', async () => {
    execFileSync('git', ['init', '-q', '-b', 'main', '--bare', BARE]);
    execFileSync('git', ['clone', '-q', BARE, STORE], { stdio: 'ignore' });
    fs.mkdirSync(path.join(STORE, 'canon'), { recursive: true });
    fs.writeFileSync(path.join(STORE, 'canon', 'README'), 'x');
    const g = (...a: string[]) => execFileSync('git', ['-C', STORE, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'ignore' });
    g('add', '-A'); g('commit', '-q', '-m', 'init'); g('push', '-q', 'origin', 'main');

    await expect(canonList({ store: STORE })).resolves.toEqual([]);          // lock free: pulls (remote present) and lists
    fs.rmSync(BARE, { recursive: true, force: true });                       // from now on any pull fails
    await expect(canonList({ store: STORE })).rejects.toThrow();             // lock free: the pull runs and fails

    const lock = `${STORE}.writer.lock`;
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, label: 'test-writer', ts: Date.now() }));
    try {
      await expect(canonList({ store: STORE })).resolves.toEqual([]);        // lock held: no pull, the read uses the store as it is
      expect(fs.existsSync(lock)).toBe(true);                                 // the other writer's lock is left alone
    } finally { fs.rmSync(lock, { force: true }); }
  });
});
