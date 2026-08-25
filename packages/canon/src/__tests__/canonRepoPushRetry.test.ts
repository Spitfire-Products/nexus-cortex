/**
 * canonRepo guardedPush — multi-writer safety for every canon commit path.
 *
 * The store historically assumed ONE writer: each verb ended with a bare
 * `git push origin main`, so a second writer (another machine, a bench
 * worker fleet, watcher + cron overlap) that pushed first left this clone
 * permanently diverged — every later push fails non-fast-forward and the
 * failure compounds (the next cycle commits on the same stale base).
 *
 * guardedPush closes it: push; on rejection `pull --rebase` (append-only
 * writers touch disjoint files, so rebase is the correct recovery) and
 * retry; on a real rebase CONFLICT abort the rebase and report false —
 * never force, never leave the clone mid-rebase (the next cycle must find
 * a clean tree). Behavior under test with REAL git repos, no mocks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { canonGit, guardedPush } from '../canonRepo.js';

let root: string;
let bare: string;
let cloneA: string;
let cloneB: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function seedIdentity(cwd: string): void {
  git(cwd, 'config', 'user.email', 'test@canon.local');
  git(cwd, 'config', 'user.name', 'canon-test');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-push-'));
  bare = path.join(root, 'origin.git');
  cloneA = path.join(root, 'a');
  cloneB = path.join(root, 'b');
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { encoding: 'utf8' });
  execFileSync('git', ['clone', '-q', bare, cloneA], { encoding: 'utf8' });
  seedIdentity(cloneA);
  fs.writeFileSync(path.join(cloneA, 'seed.txt'), 'seed\n');
  git(cloneA, 'add', '-A');
  git(cloneA, 'commit', '-q', '-m', 'seed');
  git(cloneA, 'push', '-q', 'origin', 'main');
  execFileSync('git', ['clone', '-q', bare, cloneB], { encoding: 'utf8' });
  seedIdentity(cloneB);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('guardedPush', () => {
  it('plain fast-forward push succeeds (single-writer path unchanged)', () => {
    fs.writeFileSync(path.join(cloneA, 'a.txt'), 'a\n');
    git(cloneA, 'add', '-A');
    git(cloneA, 'commit', '-q', '-m', 'a');
    const g = canonGit(cloneA, 'test');
    expect(guardedPush(g, 'test')).toBe(true);
    expect(git(cloneB, 'ls-remote', 'origin', 'main')).toContain(git(cloneA, 'rev-parse', 'HEAD').trim());
  });

  it('DIVERGED push (disjoint files) rebases and succeeds — the multi-writer case', () => {
    // writer B lands first
    fs.writeFileSync(path.join(cloneB, 'b.txt'), 'b\n');
    git(cloneB, 'add', '-A');
    git(cloneB, 'commit', '-q', '-m', 'b');
    git(cloneB, 'push', '-q', 'origin', 'main');
    // writer A commits on the now-stale base
    fs.writeFileSync(path.join(cloneA, 'a.txt'), 'a\n');
    git(cloneA, 'add', '-A');
    git(cloneA, 'commit', '-q', '-m', 'a');
    const g = canonGit(cloneA, 'test');
    expect(guardedPush(g, 'test')).toBe(true);
    // remote main now carries BOTH files
    git(cloneB, 'pull', '-q', '--rebase', 'origin', 'main');
    expect(fs.existsSync(path.join(cloneB, 'a.txt'))).toBe(true);
    expect(fs.existsSync(path.join(cloneB, 'b.txt'))).toBe(true);
  });

  it('true CONFLICT aborts the rebase, returns false, leaves a clean tree (no force, no mid-rebase wreck)', () => {
    fs.writeFileSync(path.join(cloneB, 'same.txt'), 'from-b\n');
    git(cloneB, 'add', '-A');
    git(cloneB, 'commit', '-q', '-m', 'b-same');
    git(cloneB, 'push', '-q', 'origin', 'main');
    fs.writeFileSync(path.join(cloneA, 'same.txt'), 'from-a\n');
    git(cloneA, 'add', '-A');
    git(cloneA, 'commit', '-q', '-m', 'a-same');
    const g = canonGit(cloneA, 'test');
    expect(guardedPush(g, 'test')).toBe(false);
    // tree must be clean and usable for the next cycle (rebase aborted)
    expect(git(cloneA, 'status', '--porcelain').trim()).toBe('');
    expect(fs.existsSync(path.join(cloneA, '.git', 'rebase-merge'))).toBe(false);
    expect(fs.existsSync(path.join(cloneA, '.git', 'rebase-apply'))).toBe(false);
    // remote untouched by the failed writer
    expect(git(cloneA, 'ls-remote', 'origin', 'main')).toContain(git(cloneB, 'rev-parse', 'HEAD').trim());
  });
});
