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
import { classifyCheckRun, isInvestigateCommandAllowed, readFileSlice, formatEvidenceRound } from '../judgeEvidence.js';

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

// R162 HB-JUDGE-DELTA-BUILDDIRS (2026-09-16): build/vendor dirs must not crowd the edited source out of the judge's delta.
import { prioritizeDeltaCandidates, selectDeltaFiles as _sdf } from '../judgeEvidence.js';
describe('prioritizeDeltaCandidates (R162)', () => {
  it('drops build dirs and puts edited source ahead of data even when target/ files dominate the list', () => {
    const list = [...Array.from({ length: 70 }, (_, i) => `target/scala-2.12/classes/tb/dedup/C${i}.class`), 'data/corpus.parquet',
      'submission/src/main/scala/tb/dedup/submission/SubmissionDedup.scala', '.cortex/sessions/x.jsonl', 'notes.txt'];
    const out = prioritizeDeltaCandidates(list);
    expect(out[0]).toBe('submission/src/main/scala/tb/dedup/submission/SubmissionDedup.scala');
    expect(out).toContain('notes.txt');
    expect(out.some((p) => p.startsWith('target/'))).toBe(false);
    expect(out.some((p) => p.startsWith('.cortex/'))).toBe(false);
    expect(_sdf(out, 8)[0]).toBe('submission/src/main/scala/tb/dedup/submission/SubmissionDedup.scala');
  });
});

describe('R166b classifyCheckRun — only a completed, non-zero, non-silent check is evidence', () => {
  it('passed / failed / inconclusive', () => {
    expect(classifyCheckRun('CHECK RUN: `pytest -q` → PASSED in 12 ms\n3 passed')).toBe('passed');
    expect(classifyCheckRun('CHECK RUN: `pytest -q` → FAILED (exit 1) in 12 ms\nAssertionError: expected 3 got 2')).toBe('failed');
    expect(classifyCheckRun('CHECK RUN: `python3 -c "..."` → FAILED (exit 1) in 5 ms\n(no output)')).toBe('inconclusive');
    expect(classifyCheckRun('CHECK RUN: `make test` → TIMED OUT after 45000 ms (not a pass) in 45001 ms\npartial output')).toBe('inconclusive');
    expect(classifyCheckRun('garbage')).toBe('inconclusive');
  });
});

describe('judgeEvidence — R170 investigation surface', () => {
  it('denylist: read-only commands and test runs pass; mutations, redirects to files, installs and git state changes are refused', () => {
    for (const ok of ['ls -la out/', 'cat main.py | head -50', 'python3 -m pytest -q tests/', 'grep -rn TODO src', 'test -f out/report.csv', 'diff a b', 'git status', 'git diff --stat', 'make check 2>&1 | tail -20', 'echo hi >&2'])
      expect(isInvestigateCommandAllowed(ok), ok).toBe(true);
    for (const bad of ['rm -rf out', 'mv a b', 'git checkout -- .', 'git reset --hard', 'echo x > out.txt', 'pip install numpy', 'sudo ls', 'cat a > b', 'apt-get install jq', 'kill -9 1', 'chmod +x run.sh'])
      expect(isInvestigateCommandAllowed(bad), bad).toBe(false);
  });
  it('readFileSlice: in-workspace slices with line numbers; ranges; directories; refusals for escapes, binaries, missing files', () => {
    const d = mkdtempSync(join(tmpdir(), 'r170-'));
    try {
      mkdirSync(join(d, 'src'));
      writeFileSync(join(d, 'src', 'a.py'), Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n'));
      writeFileSync(join(d, 'img.png'), 'x');
      const r = readFileSlice(d, 'src/a.py:10-12');
      expect(r).toContain('lines 10-12 of 200'); expect(r).toContain('10: line 10'); expect(r).toContain('12: line 12'); expect(r).not.toContain('13: line');
      expect(readFileSlice(d, 'src/a.py')).toContain('lines 1-120 of 200');
      expect(readFileSlice(d, 'src/a.py', 5)).toContain('lines 1-5 of 200');
      expect(readFileSlice(d, 'src')).toContain('DIRECTORY'); expect(readFileSlice(d, 'src')).toContain('a.py');
      expect(readFileSlice(d, '../etc/passwd')).toContain('REFUSED'); expect(readFileSlice(d, '/etc/passwd')).toContain('REFUSED');
      expect(readFileSlice(d, 'img.png')).toContain('REFUSED (binary)'); expect(readFileSlice(d, 'nope.txt')).toContain('NOT FOUND');
      expect(readFileSlice(d, join(d, 'src/a.py:1-2'))).toContain('lines 1-2'); // absolute path INSIDE the workspace is fine
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it('formatEvidenceRound: labelled, ordered, bounded', () => {
    const e = formatEvidenceRound(2, ['CHECK RUN: `ls` → PASSED in 1 ms\nout'], ['READ: `a` → lines 1-1 of 1\n1: x']);
    expect(e.startsWith('EVIDENCE (investigation round 2')).toBe(true); expect(e.indexOf('CHECK RUN')).toBeLessThan(e.indexOf('READ:'));
    expect(formatEvidenceRound(1, ['x'.repeat(9000)], [], 6000)).toContain('(evidence truncated)');
  });
});
