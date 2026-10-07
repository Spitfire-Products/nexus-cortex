/**
 * WorkspaceSnapshot — whole-tree snapshot / restore over a SHADOW git repository (R239 / P4, 2026-10-07).
 *
 * The second-attempt chain (R194) needs to put the task workspace back to its start state between attempts and to restore the chosen
 * attempt's tree at the end. Nothing in the library did that (FileCheckpointManager backs up only files the tools touched; the orient
 * baseline detects changes but cannot restore). This is the library port of the bench adapter's `_SA_SNAPSHOT` shadow git
 * (nexus_cortex_agent.py, commit 2bd888751): a git dir OUTSIDE the workspace (`--git-dir=<gitDir> --work-tree=<workspace>`), the same
 * exclude list (vendor dirs, build output, the harness state dir) plus every file over `bigFileBytes`, tags `lift` / `attempt<k>`, and
 * `reset --hard <tag> && clean -fdq` to restore.
 *
 * Known limit (the adapter's TB2_ATTEMPTS note): a nested vendor repo is stored as a gitlink and its CONTENTS are never restored. A tar
 * backend is the fix when a task ships nested repos; this class keeps the shadow-git behaviour the bench measured.
 *
 * Every method is synchronous, never throws, and reports success as a boolean; a failure disables the chain for the task (fail-open).
 */
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

/** The adapter's exclude list (ADP:128): never snapshotted, never cleaned. */
export const SNAPSHOT_EXCLUDES = [
  'node_modules/', '.git/', '.venv/', 'venv/', '__pycache__/', 'dist/', 'build/', 'target/', '.cache/', '.cortex/', '.addon-tools/',
  '.ivy2/', '.sbt/', '.m2/', '.gradle/', '.npm/', '*.pyc',
];

export interface WorkspaceSnapshotOptions {
  /** The tree to snapshot (the task workspace). */
  workspace: string;
  /** Where the shadow repository lives — MUST be outside `workspace` (or under an excluded dir such as `.cortex/`). */
  gitDir: string;
  /** Files larger than this are excluded from the snapshot (default 20 MiB, the adapter's `-size +20M`). */
  bigFileBytes?: number;
  /** Timeouts (ms) for the slow verbs. */
  addTimeoutMs?: number;
  commitTimeoutMs?: number;
  /** Logger for one-line diagnostics (default: silent). */
  log?: (line: string) => void;
}

const GIT_IDENTITY = ['-c', 'user.email=cortex@attempts', '-c', 'user.name=cortex-attempts', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];

export class WorkspaceSnapshot {
  readonly workspace: string;
  readonly gitDir: string;
  private readonly bigFileBytes: number;
  private readonly addTimeoutMs: number;
  private readonly commitTimeoutMs: number;
  private readonly log: (line: string) => void;
  private ready = false;

  constructor(opts: WorkspaceSnapshotOptions) {
    this.workspace = opts.workspace;
    this.gitDir = opts.gitDir;
    this.bigFileBytes = opts.bigFileBytes ?? 20 * 1024 * 1024;
    this.addTimeoutMs = opts.addTimeoutMs ?? 180_000;
    this.commitTimeoutMs = opts.commitTimeoutMs ?? 120_000;
    this.log = opts.log ?? (() => {});
  }

  /** true when a `git` binary answers on PATH. */
  static gitAvailable(): boolean {
    try { return spawnSync('git', ['--version'], { stdio: 'ignore', timeout: 10_000 }).status === 0; } catch { return false; }
  }

  /** Whether `init()` succeeded. */
  get isReady(): boolean { return this.ready; }

  private git(args: string[], timeoutMs = 60_000): SpawnSyncReturns<string> {
    return spawnSync('git', [`--git-dir=${this.gitDir}`, `--work-tree=${this.workspace}`, ...GIT_IDENTITY, ...args], {
      cwd: this.workspace, encoding: 'utf-8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  }

  private ok(r: SpawnSyncReturns<string>, what: string): boolean {
    if (r.status === 0) return true;
    this.log(`[WorkspaceSnapshot] ${what} failed (status ${r.status ?? 'signal'}): ${String(r.stderr ?? r.error?.message ?? '').trim().slice(0, 300)}`);
    return false;
  }

  /** Big files (> bigFileBytes) relative to the workspace, found with `find` (the adapter's rule); empty when `find` is unavailable. */
  private bigFiles(): string[] {
    try {
      const r = spawnSync('find', ['.', '-type', 'f', '-size', `+${Math.max(1, Math.floor(this.bigFileBytes / 1024))}k`], {
        cwd: this.workspace, encoding: 'utf-8', timeout: 120_000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
      });
      if (r.status !== 0 || !r.stdout) return [];
      return r.stdout.split('\n').map((s) => s.trim()).filter((s) => s && !/(^|\/)(node_modules|\.git)(\/|$)/.test(s)).map((s) => s.replace(/^\.\//, ''));
    } catch { return []; }
  }

  /** Create (or recreate) the shadow repository with the exclude list. false = git missing / init failed. */
  init(): boolean {
    this.ready = false;
    if (!existsSync(this.workspace)) { this.log(`[WorkspaceSnapshot] workspace missing: ${this.workspace}`); return false; }
    if (!WorkspaceSnapshot.gitAvailable()) { this.log('[WorkspaceSnapshot] no git on PATH — snapshot disabled'); return false; }
    try {
      rmSync(this.gitDir, { recursive: true, force: true });
      mkdirSync(this.gitDir, { recursive: true });
      // exactly the adapter's `git --git-dir=$SG --work-tree=$PWD init -q`: a non-bare repo whose git dir lives outside the tree
      if (!this.ok(this.git(['init', '-q']), 'init')) return false;
      mkdirSync(join(this.gitDir, 'info'), { recursive: true });
      const excludes = [...SNAPSHOT_EXCLUDES, ...this.bigFiles()];
      writeFileSync(join(this.gitDir, 'info', 'exclude'), excludes.join('\n') + '\n', 'utf-8');
      this.ready = true;
      return true;
    } catch (e) {
      this.log(`[WorkspaceSnapshot] init threw: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
      return false;
    }
  }

  /** Stage everything, commit (allow-empty) and (re)tag. Returns false on any failure. */
  commit(tag: string): boolean {
    if (!this.ready) return false;
    if (!this.ok(this.git(['add', '-A', '.'], this.addTimeoutMs), `add (${tag})`)) return false;
    if (!this.ok(this.git(['commit', '-q', '-m', tag, '--allow-empty'], this.commitTimeoutMs), `commit (${tag})`)) return false;
    return this.ok(this.git(['tag', '-f', tag]), `tag (${tag})`);
  }

  /** `reset --hard <tag>` + `clean -fdq` (excluded paths untouched). Returns false on any failure. */
  restore(tag: string): boolean {
    if (!this.ready) return false;
    if (!this.ok(this.git(['reset', '-q', '--hard', tag], this.commitTimeoutMs), `reset (${tag})`)) return false;
    return this.ok(this.git(['clean', '-fdq'], this.commitTimeoutMs), `clean (${tag})`);
  }

  /** Tags present in the shadow repository. */
  tags(): string[] {
    if (!this.ready) return [];
    const r = this.git(['tag', '--list']);
    return r.status === 0 ? r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  }

  /** Number of tracked files at HEAD (the adapter logged this at the lift snapshot). */
  fileCount(): number {
    if (!this.ready) return 0;
    const r = this.git(['ls-files']);
    return r.status === 0 ? r.stdout.split('\n').filter((s) => s.trim()).length : 0;
  }
}
