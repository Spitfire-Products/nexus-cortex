/**
 * canonInit — scaffold a canon store repository (standalone form of the
 * `cortex canon init` command; the cortex CLI wraps this with its themed
 * output). Idempotent: existing files are never overwritten, re-running
 * against a live store is a no-op. Purely local — `remote` only records the
 * origin URL, nothing is pushed.
 *
 * @module canonInit
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CANON_VERIFY_MJS, GITATTRIBUTES, STORE_DIRS, STORE_README, VERIFY_YML } from './scaffoldAssets.js';

export interface CanonInitOptions {
  /** Target directory (default: current working directory). */
  dir?: string;
  /** Remote URL to record as `origin` (no push is performed). */
  remote?: string;
}

export interface CanonInitResult {
  root: string;
  repoInitialized: boolean;
  remoteRecorded: boolean;
  created: string[];
  skipped: string[];
}

export async function canonInit(options: CanonInitOptions = {}): Promise<CanonInitResult> {
  const root = path.resolve(options.dir ?? '.');
  const created: string[] = [];
  const skipped: string[] = [];
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env });

  fs.mkdirSync(root, { recursive: true });
  let repoInitialized = false;
  if (!fs.existsSync(path.join(root, '.git'))) {
    execFileSync('git', ['init', '-q', '-b', 'main', root], { encoding: 'utf8', env });
    repoInitialized = true;
  }

  const ROOTS_TEMPLATE = JSON.stringify({
    _doc: 'Optional project-map overrides for canon graph/list. roots: {projectId: absolutePath}; claudeDirs: {encodedSessionDirName: projectId}; cortexLabels: {cortexSyncLabel: projectId}. Derivation from $HOME + the filesystem covers the common cases; add entries here for dash-ambiguous paths, sessions recorded on other machines, or sub-root labels that belong to a parent project.',
    roots: {}, claudeDirs: {}, cortexLabels: {},
  }, null, 2) + '\n';
  const files: [string, string][] = [
    ['.gitattributes', GITATTRIBUTES],
    [path.join('projects', 'ROOTS.json'), ROOTS_TEMPLATE],
    ['README.md', STORE_README],
    [path.join('.github', 'workflows', 'canon-verify.yml'), VERIFY_YML],
    [path.join('.github', 'scripts', 'canon-verify.mjs'), CANON_VERIFY_MJS],
  ];
  for (const [rel, content] of files) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) { skipped.push(rel); continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    created.push(rel);
  }
  for (const dir of STORE_DIRS) {
    const abs = path.join(root, dir);
    if (fs.existsSync(abs)) { skipped.push(dir + '/'); continue; }
    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(path.join(abs, '.gitkeep'), '');
    created.push(dir + '/');
  }

  let remoteRecorded = false;
  if (options.remote) {
    const hasOrigin = git(['remote']).split('\n').some((r) => r.trim() === 'origin');
    if (hasOrigin) skipped.push('remote origin (already set)');
    else {
      git(['remote', 'add', 'origin', options.remote]);
      remoteRecorded = true;
      created.push(`remote origin -> ${options.remote}`);
    }
  }
  return { root, repoInitialized, remoteRecorded, created, skipped };
}
