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
