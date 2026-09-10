/**
 * judgeEvidence — HB-JUDGE-GROUNDING: the judges see the deliverable (workspace delta) and, when an
 * evident check entry point exists, a real check result. Bounded + fail-soft.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import {
  resolveJudgeGroundingConfig, selectDeltaFiles, formatWorkspaceDelta, collectWorkspaceDelta,
  detectCheckCommand, runCheck,
} from '../judgeEvidence.js';

const cfg = { ...resolveJudgeGroundingConfig({}), checkTimeoutMs: 10_000 };

describe('resolveJudgeGroundingConfig', () => {
  it('defaults on; false disables; numbers bounded', () => {
    const d = resolveJudgeGroundingConfig({});
    expect(d.delta && d.runCheck).toBe(true);
    expect(d.checkTimeoutMs).toBe(45_000);
    const off = resolveJudgeGroundingConfig({ CORTEX_JUDGE_DELTA: 'false', CORTEX_JUDGE_RUN_CHECK: 'false', CORTEX_JUDGE_CHECK_TIMEOUT_MS: '7000' } as any);
    expect(off.delta || off.runCheck).toBe(false);
    expect(off.checkTimeoutMs).toBe(7000);
    expect(resolveJudgeGroundingConfig({ CORTEX_JUDGE_DELTA_MAX_FILES: '-3' } as any).deltaMaxFiles).toBe(8);
  });
});

describe('selectDeltaFiles / formatWorkspaceDelta (pure)', () => {
  it('skips vendor dirs and binaries, dedups, caps', () => {
    const out = selectDeltaFiles(['app.py', 'node_modules/x/y.js', 'img.png', 'app.py', 'src/b.c', 'dist/z.js', 'c.txt'], 2);
    expect(out).toEqual(['app.py', 'src/b.c']);
  });
  it('formats with per-file headers and truncates at the cap', () => {
    const t = formatWorkspaceDelta('SUMMARY', [{ path: 'a.py', head: 'print(1)', lines: 100, truncated: true }], 10_000);
    expect(t).toContain('SUMMARY');
    expect(t).toContain('--- a.py (100 lines, head shown) ---\nprint(1)');
    expect(formatWorkspaceDelta('S', [{ path: 'b', head: 'x'.repeat(500) }], 100)).toContain('[delta truncated]');
  });
});

describe('collectWorkspaceDelta', () => {
  it('non-git workspace: lists files modified since the task start with their heads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'je-'));
    try {
      const since = Date.now() - 5000;
      writeFileSync(join(dir, 'filter.py'), 'import sys\nprint("hi")\n');
      mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'x', 'i.js'), 'ignored');
      const d = collectWorkspaceDelta(dir, since, cfg);
      expect(d).toContain('WORKSPACE DELTA');
      expect(d).toContain('filter.py');
      expect(d).toContain('print("hi")');
      expect(d).not.toContain('node_modules');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('git workspace: shows status + diff stat + heads of changed and untracked files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'je-git-'));
    try {
      execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir, shell: '/bin/sh' });
      writeFileSync(join(dir, 'tracked.txt'), 'v1\n');
      execSync('git add tracked.txt && git -c user.email=t@t -c user.name=t commit -q -m one', { cwd: dir, shell: '/bin/sh' });
      writeFileSync(join(dir, 'tracked.txt'), 'v2 changed\n');
      writeFileSync(join(dir, 'new.py'), 'def f():\n    return 1\n');
      const d = collectWorkspaceDelta(dir, Date.now() - 5000, cfg);
      expect(d).toContain('git');
      expect(d).toContain('tracked.txt');
      expect(d).toContain('v2 changed');
      expect(d).toContain('new.py');
      expect(d).toContain('return 1');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('returns empty when disabled or when nothing changed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'je-empty-'));
    try {
      expect(collectWorkspaceDelta(dir, Date.now(), { ...cfg, delta: false })).toBe('');
      expect(collectWorkspaceDelta(dir, Date.now() + 60_000, cfg)).toBe('');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('detectCheckCommand / runCheck', () => {
  it('finds a Makefile test target, test.sh, or a pytest layout; null otherwise', () => {
    const dir = mkdtempSync(join(tmpdir(), 'je-chk-'));
    try {
      expect(detectCheckCommand(dir)).toBeNull();
      writeFileSync(join(dir, 'Makefile'), 'build:\n\techo b\ntest:\n\techo ok\n');
      expect(detectCheckCommand(dir)).toBe('make test');
      rmSync(join(dir, 'Makefile'));
      writeFileSync(join(dir, 'test.sh'), 'exit 0\n');
      expect(detectCheckCommand(dir)).toBe('sh ./test.sh');
      rmSync(join(dir, 'test.sh'));
      mkdirSync(join(dir, 'tests'));
      expect(detectCheckCommand(dir)).toContain('pytest');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('runs the check bounded and labels PASSED / FAILED / TIMED OUT with the tail of the output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'je-run-'));
    try {
      expect(runCheck(dir, 'echo all good; exit 0', cfg)).toMatch(/→ PASSED in \d+ ms\nall good/);
      expect(runCheck(dir, 'echo boom >&2; exit 3', cfg)).toMatch(/→ FAILED \(exit 3\)/);
      const t = runCheck(dir, 'sleep 5', { ...cfg, checkTimeoutMs: 300 });
      expect(t).toContain('TIMED OUT');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
