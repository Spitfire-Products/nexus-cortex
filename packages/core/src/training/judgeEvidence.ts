/**
 * judgeEvidence — HB-JUDGE-GROUNDING (2026-09-10): the EVIDENCE the done/not-done judges (EndTurn
 * resolver, deadline exit planner) verify against.
 *
 * The judge prompts (endTurnResolver.ts / deadlineExitMentor.ts) already ask for an adversarial check of
 * the work against the task's real criteria and promise the judge "the work product + the checks it ran"
 * and an environment report. Until now the orchestrator handed them the junior's prose, the OLDEST 4K of
 * tool output and a start-of-task tooling inventory — never the deliverable. cell-d-k3 (42 rows): the
 * resolver held 9/10 PASSING finishes, the exit planner mis-called 3/3 real done/not-done decisions.
 *
 * This module supplies what the prompts assume:
 *   - collectWorkspaceDelta: the files changed since the task started (git status/diff --stat when in a
 *     repo, else a mtime scan) + a bounded head of each — the deliverable itself, not a description of it.
 *   - detectCheckCommand / runCheck: when the workspace carries an evident check entry point
 *     (Makefile `test` target, test.sh / run_tests.sh, pytest layout), run it (bounded) and hand the
 *     judge the result, so HOLD/FINISH can be anchored to a real check.
 * Every leg is fail-soft and bounded (shell timeouts, output caps); a judge must never hang or throw on
 * evidence collection. Pure config resolution is exported for tests.
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

export interface JudgeGroundingConfig {
  /** CORTEX_JUDGE_DELTA: hand the judges the workspace delta (files changed this task + heads). Default on. */
  delta: boolean;
  /** CORTEX_JUDGE_RUN_CHECK: at the EndTurn resolver, run an evident check entry point and hand the judge its result. Default on. */
  runCheck: boolean;
  /** CORTEX_JUDGE_CHECK_TIMEOUT_MS: cap on the check run. Default 45000. */
  checkTimeoutMs: number;
  /** CORTEX_JUDGE_DELTA_MAX_FILES: files whose head is included. Default 8. */
  deltaMaxFiles: number;
  /** CORTEX_JUDGE_DELTA_HEAD_LINES: lines of each changed file shown. Default 60. */
  deltaHeadLines: number;
  /** Total character cap on the delta text. Default 6000. */
  deltaMaxChars: number;
}

const DEFAULTS: JudgeGroundingConfig = {
  delta: true, runCheck: true, checkTimeoutMs: 45_000, deltaMaxFiles: 8, deltaHeadLines: 60, deltaMaxChars: 6000,
};

function flagNotFalse(v: string | undefined): boolean {
  return (v ?? '').trim().toLowerCase() !== 'false';
}
function intOr(v: string | undefined, d: number): number {
  const n = parseInt((v ?? '').trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : d;
}

export function resolveJudgeGroundingConfig(env: NodeJS.ProcessEnv = process.env): JudgeGroundingConfig {
  return {
    delta: flagNotFalse(env.CORTEX_JUDGE_DELTA),
    runCheck: flagNotFalse(env.CORTEX_JUDGE_RUN_CHECK),
    checkTimeoutMs: intOr(env.CORTEX_JUDGE_CHECK_TIMEOUT_MS, DEFAULTS.checkTimeoutMs),
    deltaMaxFiles: intOr(env.CORTEX_JUDGE_DELTA_MAX_FILES, DEFAULTS.deltaMaxFiles),
    deltaHeadLines: intOr(env.CORTEX_JUDGE_DELTA_HEAD_LINES, DEFAULTS.deltaHeadLines),
    deltaMaxChars: DEFAULTS.deltaMaxChars,
  };
}

function sh(cmd: string, cwd: string, timeoutMs: number, maxBuffer = 512 * 1024): string {
  try {
    return String(execSync(cmd, { cwd, timeout: timeoutMs, encoding: 'utf8', maxBuffer, stdio: ['ignore', 'pipe', 'ignore'], shell: '/bin/sh' }));
  } catch (e: any) {
    return String(e?.stdout ?? '');
  }
}

const SKIP_DIRS = /(^|\/)(node_modules|\.git|\.venv|venv|__pycache__|dist|build|target|\.cache)(\/|$)/;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|bmp|pdf|zip|tar|gz|bz2|xz|7z|whl|so|o|a|bin|exe|dll|dylib|pyc|class|jar|wasm|mp3|mp4|wav|ogg|ttf|otf|woff2?)$/i;

/** Pure: pick the files to show from a list of changed paths — skip build/vendor dirs and binaries, cap the count. */
export function selectDeltaFiles(paths: string[], maxFiles: number): string[] {
  const out: string[] = [];
  for (const raw of paths) {
    const p = raw.trim();
    if (!p || SKIP_DIRS.test(p) || BINARY_EXT.test(p)) continue;
    if (!out.includes(p)) out.push(p);
    if (out.length >= maxFiles) break;
  }
  return out;
}

/** Pure: format the delta text from the pieces (status lines + per-file heads), bounded. */
export function formatWorkspaceDelta(
  summary: string,
  files: Array<{ path: string; head: string; lines?: number; truncated?: boolean }>,
  maxChars: number,
): string {
  const parts: string[] = [];
  if (summary.trim()) parts.push(summary.trim());
  for (const f of files) {
    const tag = f.lines !== undefined ? ` (${f.lines} lines${f.truncated ? ', head shown' : ''})` : '';
    parts.push(`--- ${f.path}${tag} ---\n${f.head.replace(/\s+$/, '')}`);
  }
  const text = parts.join('\n');
  return text.length > maxChars ? text.slice(0, maxChars) + '\n…[delta truncated]' : text;
}

/**
 * The files changed since `sinceMs` (task start) and a bounded head of each. In a git repo: `git status
 * --short` (modified + untracked) + `git diff --stat`; otherwise a POSIX `find -newermt @epoch` scan.
 * Returns '' when nothing changed or on any failure (the judge then sees no delta section — fail-soft).
 */
export function collectWorkspaceDelta(cwd: string, sinceMs: number, cfg: JudgeGroundingConfig = resolveJudgeGroundingConfig()): string {
  if (!cfg.delta || !cwd || !existsSync(cwd)) return '';
  const inRepo = sh('git rev-parse --is-inside-work-tree 2>/dev/null', cwd, 3000).trim() === 'true';
  let summary = '';
  let candidates: string[] = [];
  if (inRepo) {
    const status = sh('git status --short --untracked-files=all 2>/dev/null | head -60', cwd, 5000);
    const stat = sh('git diff --stat 2>/dev/null | tail -20', cwd, 5000);
    summary = ['WORKSPACE DELTA (files changed this task, git):', status.trim() || '(no changes vs HEAD)', stat.trim()].filter(Boolean).join('\n');
    candidates = status.split('\n').map((l) => l.slice(3).trim()).filter(Boolean)
      .map((p) => (p.includes(' -> ') ? p.split(' -> ').pop()!.trim() : p));
  } else {
    const epoch = Math.max(0, Math.floor(sinceMs / 1000) - 1);
    const found = sh(`find . -type f -newermt @${epoch} 2>/dev/null | grep -v -E '/(node_modules|\\.git|__pycache__|\\.venv|venv)/' | head -60`, cwd, 8000);
    const list = found.split('\n').map((l) => l.replace(/^\.\//, '').trim()).filter(Boolean);
    if (list.length === 0) return '';
    summary = ['WORKSPACE DELTA (files modified this task):', ...list.slice(0, 40)].join('\n');
    candidates = list;
  }
  const files = selectDeltaFiles(candidates, cfg.deltaMaxFiles).map((p) => {
    try {
      const full = join(cwd, p);
      const st = statSync(full);
      if (!st.isFile() || st.size > 2 * 1024 * 1024) return { path: p, head: `(${st.isFile() ? st.size + ' bytes, not shown' : 'not a regular file'})` };
      const all = readFileSync(full, 'utf8').split('\n');
      const truncated = all.length > cfg.deltaHeadLines;
      return { path: p, head: all.slice(0, cfg.deltaHeadLines).join('\n'), lines: all.length, truncated };
    } catch {
      return { path: p, head: '(unreadable)' };
    }
  });
  if (!summary && files.length === 0) return '';
  return formatWorkspaceDelta(summary, files, cfg.deltaMaxChars);
}

/**
 * Pure-ish: find an EVIDENT check entry point in the workspace (task-provided, not the junior's ad-hoc
 * tests): a Makefile with a `test` target, test.sh / run_tests.sh / run-tests.sh, or a pytest layout
 * (tests/ dir or test_*.py at the root). Returns the command or null.
 */
export function detectCheckCommand(cwd: string): string | null {
  try {
    for (const mk of ['Makefile', 'makefile', 'GNUmakefile']) {
      const p = join(cwd, mk);
      if (existsSync(p) && /^test\s*:/m.test(readFileSync(p, 'utf8'))) return 'make test';
    }
    for (const s of ['test.sh', 'run_tests.sh', 'run-tests.sh', 'tests.sh']) {
      if (existsSync(join(cwd, s))) return `sh ./${s}`;
    }
    if (existsSync(join(cwd, 'pytest.ini')) || existsSync(join(cwd, 'tests')) || existsSync(join(cwd, 'test'))) {
      return 'python3 -m pytest -q -x --no-header -p no:cacheprovider 2>&1 | tail -40';
    }
    const rootTests = sh("ls test_*.py *_test.py 2>/dev/null | head -1", cwd, 2000).trim();
    if (rootTests) return 'python3 -m pytest -q -x --no-header -p no:cacheprovider 2>&1 | tail -40';
  } catch { /* fail-soft */ }
  return null;
}

/** Run a check command bounded by the config; returns a labeled, capped result the judge can cite. */
export function runCheck(cwd: string, cmd: string, cfg: JudgeGroundingConfig = resolveJudgeGroundingConfig()): string {
  const t0 = Date.now();
  let out = '';
  let code = 0;
  try {
    out = String(execSync(cmd, { cwd, timeout: cfg.checkTimeoutMs, encoding: 'utf8', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], shell: '/bin/sh' }));
  } catch (e: any) {
    code = typeof e?.status === 'number' ? e.status : (e?.killed || /ETIMEDOUT|timed out/i.test(String(e?.message)) ? 124 : 1);
    out = `${String(e?.stdout ?? '')}\n${String(e?.stderr ?? '')}`;
  }
  const ms = Date.now() - t0;
  const body = out.trim().length > 2500 ? out.trim().slice(-2500) : out.trim();
  const verdict = code === 0 ? 'PASSED' : code === 124 ? `TIMED OUT after ${cfg.checkTimeoutMs} ms (not a pass)` : `FAILED (exit ${code})`;
  return `CHECK RUN: \`${cmd}\` → ${verdict} in ${ms} ms\n${body || '(no output)'}`;
}
