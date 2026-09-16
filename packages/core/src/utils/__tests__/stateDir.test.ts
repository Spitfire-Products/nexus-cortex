import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, chmodSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveCortexStateDir, resetCortexStateDirCache, cortexStatePath, hashProjectPath } from '../stateDir';

describe('HB-READONLY-WORKDIR (4.108.6, R131) — resolveCortexStateDir', () => {
  beforeEach(() => resetCortexStateDirCache());

  it('resolves a non-existent project path PURELY (no probe, no fallback) — synthetic roots keep <root>/.cortex', () => {
    const r = resolveCortexStateDir('/definitely/not/a/real/dir', {} as any);
    expect(r.dir).toBe(join('/definitely/not/a/real/dir', '.cortex')); expect(r.fallback).toBe(false);
    expect(existsSync('/definitely/not/a/real/dir')).toBe(false);
  });

  it('uses <project>/.cortex when the project dir is writable', () => {
    const p = mkdtempSync(join(tmpdir(), 'cortex-state-'));
    const r = resolveCortexStateDir(p, {} as any);
    expect(r.dir).toBe(join(p, '.cortex')); expect(r.fallback).toBe(false); expect(existsSync(r.dir)).toBe(true);
    expect(cortexStatePath(p, 'sessions')).toBe(join(p, '.cortex', 'sessions'));
    rmSync(p, { recursive: true, force: true });
  });

  it('falls back (and does not throw) when the project dir is not writable', () => {
    if (process.getuid && process.getuid() === 0) return; // root can always write; the probe cannot be forced
    const p = mkdtempSync(join(tmpdir(), 'cortex-ro-'));
    chmodSync(p, 0o555);
    try {
      const r = resolveCortexStateDir(p, {} as any);
      expect(r.fallback).toBe(true);
      expect(r.reason).toBeTruthy();
      expect(r.dir).not.toBe(join(p, '.cortex'));
      expect(r.dir).toContain(hashProjectPath(p));
      expect(existsSync(r.dir)).toBe(true);
    } finally { chmodSync(p, 0o755); rmSync(p, { recursive: true, force: true }); }
  });

  it('honours CORTEX_STATE_DIR as the explicit root and memoizes per project', () => {
    const p = mkdtempSync(join(tmpdir(), 'cortex-proj-'));
    const override = join(mkdtempSync(join(tmpdir(), 'cortex-override-')), 'state');
    const r1 = resolveCortexStateDir(p, { CORTEX_STATE_DIR: override } as any);
    expect(r1.dir).toBe(override); expect(r1.fallback).toBe(false);
    const r2 = resolveCortexStateDir(p, {} as any);   // memoized: same project → same decision
    expect(r2.dir).toBe(override);
    rmSync(p, { recursive: true, force: true });
  });
});

// R155 HB-STATE-DIR-GIT-EXCLUDE (2026-09-16): runtime state under <project>/.cortex must not ride into git.
import { readFileSync, writeFileSync as wfs } from 'fs';
import { ensureGitExcludesRuntimeState, CORTEX_RUNTIME_STATE_EXCLUDES } from '../stateDir';
describe('R155 ensureGitExcludesRuntimeState', () => {
  beforeEach(() => resetCortexStateDirCache());
  it('appends the runtime-state paths to .git/info/exclude once, and resolveCortexStateDir triggers it', () => {
    const p = mkdtempSync(join(tmpdir(), 'cortex-git-'));
    mkdirSync(join(p, '.git'));
    const r = resolveCortexStateDir(p, {} as any);
    expect(r.dir).toBe(join(p, '.cortex'));
    const ex = readFileSync(join(p, '.git', 'info', 'exclude'), 'utf8');
    for (const line of CORTEX_RUNTIME_STATE_EXCLUDES) expect(ex).toContain(line);
    expect(ex).toContain('R155');
    expect(ensureGitExcludesRuntimeState(p)).toBe(false); // idempotent
    expect(readFileSync(join(p, '.git', 'info', 'exclude'), 'utf8')).toBe(ex);
    rmSync(p, { recursive: true, force: true });
  });
  it('preserves an existing exclude file and follows a worktree gitdir file', () => {
    const p = mkdtempSync(join(tmpdir(), 'cortex-wt-'));
    const real = mkdtempSync(join(tmpdir(), 'cortex-gitdir-'));
    mkdirSync(join(real, 'info'));
    wfs(join(real, 'info', 'exclude'), '*.log');
    wfs(join(p, '.git'), `gitdir: ${real}\n`);
    expect(ensureGitExcludesRuntimeState(p)).toBe(true);
    const ex = readFileSync(join(real, 'info', 'exclude'), 'utf8');
    expect(ex.startsWith('*.log\n')).toBe(true);
    expect(ex).toContain('.cortex/sessions/');
    rmSync(p, { recursive: true, force: true }); rmSync(real, { recursive: true, force: true });
  });
  it('is a no-op outside a git repo', () => {
    const p = mkdtempSync(join(tmpdir(), 'cortex-nogit-'));
    expect(ensureGitExcludesRuntimeState(p)).toBe(false);
    expect(existsSync(join(p, '.git'))).toBe(false);
    rmSync(p, { recursive: true, force: true });
  });
});
