import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkCandidateChanges, globToRegExp, hashPath, matchesAny, protectGlobFor, repoRelative, sealTaskSet, taskIdsIn,
} from '../EvalGuard.js';

// Eval guard (autoresearch hardening A1): the Fixer must not reach what grades it.
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'evalguard-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('globs', () => {
  it('** crosses directories, * stays in one segment, dir/** covers the dir itself', () => {
    expect(matchesAny('bench/verify.py', ['bench/**'])).toBe(true);
    expect(matchesAny('bench', ['bench/**'])).toBe(true);
    expect(matchesAny('bench/a/b/c.ts', ['bench/**'])).toBe(true);
    expect(matchesAny('benchmarks/x.ts', ['bench/**'])).toBe(false);
    expect(matchesAny('src/a.ts', ['src/*.ts'])).toBe(true);
    expect(matchesAny('src/deep/a.ts', ['src/*.ts'])).toBe(false);
    expect(matchesAny('src/deep/a.ts', ['src/**/*.ts'])).toBe(true);
    expect(matchesAny('src/a.ts', ['src/**/*.ts'])).toBe(true);
  });
  it('a slash-free glob matches the basename at any depth; regex metacharacters are literal', () => {
    expect(matchesAny('a/b/verifier.json', ['verifier.json'])).toBe(true);
    expect(matchesAny('a/b/verifierXjson', ['verifier.json'])).toBe(false);
    expect(globToRegExp('tasks/(x)+.json').test('tasks/(x)+.json')).toBe(true);
  });
});

describe('checkCandidateChanges', () => {
  it('refuses a protected path and anything outside the editable allowlist', () => {
    const v = checkCandidateChanges(['src/a.ts', 'tasks/train.json', 'README.md'], { protect: ['tasks/train.json'], editable: ['src/**'] });
    expect(v.ok).toBe(false);
    expect(v.violations).toEqual([
      { path: 'tasks/train.json', rule: 'protected' },
      { path: 'README.md', rule: 'outside-editable' },
    ]);
  });
  it('passes in-scope changes; no allowlist = anything not protected', () => {
    expect(checkCandidateChanges(['src/a.ts'], { protect: ['bench/**'], editable: ['src/**'] }).ok).toBe(true);
    expect(checkCandidateChanges(['docs/x.md'], { protect: ['bench/**'] }).ok).toBe(true);
  });
});

describe('sealing', () => {
  it('copies a task-set out of the repo, fingerprints it, and reports its in-repo path', () => {
    const repo = tmp(); const seal = tmp();
    mkdirSync(join(repo, 'tasks'));
    writeFileSync(join(repo, 'tasks', 'hold.json'), JSON.stringify([{ id: 'h1' }, { id: 'h2' }]));
    const s = sealTaskSet(join(repo, 'tasks', 'hold.json'), seal, 'holdout', repo);
    expect(s.sealed.startsWith(seal)).toBe(true);
    expect(s.inRepo).toBe('tasks/hold.json');
    expect(s.sha256).toBe(hashPath(join(repo, 'tasks', 'hold.json')));
    // editing the in-repo copy afterwards does not change what the gate reads
    writeFileSync(join(repo, 'tasks', 'hold.json'), '[]');
    expect([...taskIdsIn(s.sealed)]).toEqual(['h1', 'h2']);
    expect(hashPath(s.sealed)).toBe(s.sha256);
  });
  it('a task-set outside the repo has no in-repo path; a dir gets a dir/** protect glob', () => {
    const repo = tmp(); const outside = tmp(); const seal = tmp();
    writeFileSync(join(outside, 'a.json'), JSON.stringify({ id: 'a' }));
    const s = sealTaskSet(outside, seal, 'train', repo);
    expect(s.inRepo).toBeUndefined();
    expect(s.isDir).toBe(true);
    expect([...taskIdsIn(s.sealed)]).toEqual(['a']);
    expect(protectGlobFor('tasks/train', true)).toBe('tasks/train/**');
    expect(repoRelative(join(repo, 'x', 'y.json'), repo)).toBe('x/y.json');
  });
});
