/**
 * HB-READONLY-WORKDIR (4.108.6, R131) — the ONE place that decides where cortex keeps its per-project state.
 *
 * The harness rooted every runtime write at `<project>/.cortex` (tmux metadata, artifact registry, sessions, decisions,
 * training samples, memory). A task image that runs the agent as an unprivileged user in a root-owned working directory
 * (Terminal-Bench 4.0 `risk-scorer-replay`: uid `nobody`, `/app` mode 755) made the very first of those writes fatal:
 * `ShellTool` → `SessionPersistence` → `mkdirSync(EACCES)` → "Failed to start server" → an empty session. State persistence
 * must never be a boot precondition: probe the project dir once; when it is not writable fall back, warn once, carry on.
 *
 * Order: `CORTEX_STATE_DIR` (explicit override) → `<project>/.cortex` → `~/.cortex/projects/<hash>` → `<tmpdir>/nexus-cortex/<hash>`.
 */
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync, appendFileSync, statSync } from 'fs';
import { join, relative, isAbsolute } from 'path';
import { homedir, tmpdir } from 'os';
import { createHash } from 'crypto';

export interface CortexStateDir {
  /** Absolute directory that plays the role of `<project>/.cortex` for runtime state. */
  dir: string;
  /** True when the project dir was not writable and a fallback location is in use. */
  fallback: boolean;
  /** Why the project dir was rejected (fallback only). */
  reason?: string;
  /** The project path the decision was made for. */
  projectPath: string;
}

const cache = new Map<string, CortexStateDir>();

/**
 * CORTEX_WORKSPACE_CLEAN (dark, 2026-09-29): nothing the harness writes lands in the task's tree. Scratch AND project knowledge (orient's
 * mechanical CORTEX.md + baseline, MemoryWrite, init_cortex_context, doctrine staging, sub-agent results, turn predictions, stored
 * compactions, the sandbox registry) go to the state dir, and the project dir stops being a state-dir candidate. Graders that list the
 * directory or diff the repo see only the model's work (TB2.1 sanitize-git-repo graded a repo holding .cortex/ copies of the secrets;
 * polyglot tasks assert listdir == [one file]). Unset = unchanged.
 */
export function resolveWorkspaceClean(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|on)$/i.test(String(env.CORTEX_WORKSPACE_CLEAN ?? '').trim());
}
const warned = new Set<string>();

function probeWritable(dir: string): string | null {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.write-probe-${process.pid}-${Date.now().toString(36)}`);
    writeFileSync(probe, '');
    unlinkSync(probe);
    return null;
  } catch (e: any) {
    return String(e?.code || e?.message || e);
  }
}

export function hashProjectPath(projectPath: string): string {
  return createHash('sha1').update(projectPath).digest('hex').slice(0, 12);
}

/**
 * Resolve (and memoize per project path) the writable state root. Never throws.
 * @param projectPath the project/working directory (defaults to process.cwd())
 */
export function resolveCortexStateDir(projectPath?: string, env: NodeJS.ProcessEnv = process.env): CortexStateDir {
  const project = projectPath || process.cwd();
  const clean = resolveWorkspaceClean(env);
  const key = project; // memoized per project (one answer for every caller in a process)
  const cached = cache.get(key);
  if (cached) return cached;
  // A project path that does not exist (unit tests with synthetic roots, a not-yet-created workspace) is resolved PURELY —
  // no probe, no fallback, no side effects. A real working directory always exists, so the read-only case is still caught.
  if (!existsSync(project)) {
    const pure: CortexStateDir = { dir: join(project, '.cortex'), fallback: false, projectPath: project };
    cache.set(key, pure);
    return pure;
  }

  const candidates: Array<{ dir: string; label: string }> = [];
  const override = String(env.CORTEX_STATE_DIR ?? '').trim();
  if (override) candidates.push({ dir: override, label: 'CORTEX_STATE_DIR' });
  if (!clean) candidates.push({ dir: join(project, '.cortex'), label: 'project' });
  const hash = hashProjectPath(project);
  candidates.push({ dir: join(homedir() || tmpdir(), '.cortex', 'projects', hash), label: 'home' });
  candidates.push({ dir: join(tmpdir(), 'nexus-cortex', hash), label: 'tmp' });

  let reason: string | undefined;
  let result: CortexStateDir | undefined;
  for (const c of candidates) {
    const err = probeWritable(c.dir);
    if (err === null) {
      const isPrimary = c.label === 'project' || c.label === 'CORTEX_STATE_DIR';
      result = { dir: c.dir, fallback: !isPrimary, reason: isPrimary ? undefined : reason, projectPath: project };
      if (c.label === 'project') ensureGitExcludesRuntimeState(project);
      if (clean) ensureGitExcludesStateDir(project, c.dir);
      break;
    }
    if (c.label === 'project') reason = err;
  }
  if (!result) {
    // Nothing writable at all: keep the project path so callers still produce sane paths; every writer must be best-effort.
    result = { dir: join(project, '.cortex'), fallback: true, reason: reason ?? 'no writable location', projectPath: project };
  }
  if (result.fallback && !warned.has(project)) {
    warned.add(project);
    console.warn(`[WARN] cortex state: ${join(project, '.cortex')} is not writable (${result.reason}); using ${result.dir}`);
  }
  cache.set(key, result);
  return result;
}

/** Where project knowledge lives (CORTEX.md, MEMORY.md + memory/, doctrine staging): `<project>/.cortex`, or the state dir when clean. */
export function cortexProjectDir(projectPath?: string, env: NodeJS.ProcessEnv = process.env): string {
  const project = projectPath || process.cwd();
  return resolveWorkspaceClean(env) ? resolveCortexStateDir(project, env).dir : join(project, '.cortex');
}

/** Base dir for writers that root their own subdir at the working dir (the sandbox registry's .addon-tools/): the state dir when clean. */
export function harnessScratchBase(workingDir?: string, env: NodeJS.ProcessEnv = process.env): string {
  const wd = workingDir || process.cwd();
  return resolveWorkspaceClean(env) ? resolveCortexStateDir(wd, env).dir : wd;
}

/** Clean mode with a state dir that still sits inside the project's repo (an explicit CORTEX_STATE_DIR under it): exclude it whole. */
function ensureGitExcludesStateDir(project: string, dir: string): void {
  try {
    const rel = relative(project, dir);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return;
    const gitDir = gitDirOf(project);
    if (!gitDir) return;
    const excludePath = join(gitDir, 'info', 'exclude');
    const line = `${rel.split('\\').join('/')}/`;
    const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
    if (current.split(/\r?\n/).includes(line)) return;
    mkdirSync(join(gitDir, 'info'), { recursive: true });
    const lead = current.length && !current.endsWith('\n') ? '\n' : '';
    appendFileSync(excludePath, `${lead}# nexus-cortex state dir (CORTEX_WORKSPACE_CLEAN)\n${line}\n`);
  } catch { /* best-effort */ }
}

function gitDirOf(project: string): string | null {
  const dotGit = join(project, '.git');
  if (!existsSync(dotGit)) return null;
  if (!statSync(dotGit).isFile()) return dotGit;
  const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'));
  if (!m) return null;
  const g = m[1]!.trim();
  return g.startsWith('/') ? g : join(project, g);
}

/** Runtime-state paths under <project>/.cortex that must never ride into the project's git history. */
export const CORTEX_RUNTIME_STATE_EXCLUDES = [
  '.cortex/sessions/',
  '.cortex/artifacts/',
  '.cortex/training/',
  '.cortex/decisions.jsonl',
  '.cortex/memory/',
  '.cortex/projects/',
  '.cortex/.write-probe-*',
];
const GIT_EXCLUDE_MARKER = '# nexus-cortex runtime state (R155) — auto-added; CORTEX.md stays trackable';

/**
 * R155 HB-STATE-DIR-GIT-EXCLUDE (2026-09-16, tb4-flash-v3 nextjs-performance): the state dir sits inside the
 * project's working tree, so a model (or a person) running `git add -A` commits live session files and a later
 * `git checkout <rev> -- .` restores a STALE session over the live one — the trajectory then starts mid-session.
 * `.git/info/exclude` is the repo-local ignore file that never touches the user's tracked `.gitignore`. Best-effort
 * and idempotent (marker line); a worktree's `.git` FILE is honoured by resolving its gitdir. Does not cover
 * `git clean -x` (which removes ignored files by design).
 */
export function ensureGitExcludesRuntimeState(project: string): boolean {
  try {
    const dotGit = join(project, '.git');
    if (!existsSync(dotGit)) return false;
    let gitDir = dotGit;
    if (statSync(dotGit).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'));
      if (!m) return false;
      gitDir = m[1]!.trim();
      if (!gitDir.startsWith('/')) gitDir = join(project, gitDir);
    }
    const infoDir = join(gitDir, 'info');
    const excludePath = join(infoDir, 'exclude');
    const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
    if (current.includes(GIT_EXCLUDE_MARKER)) return false;
    mkdirSync(infoDir, { recursive: true });
    const missing = CORTEX_RUNTIME_STATE_EXCLUDES.filter((l) => !current.split(/\r?\n/).includes(l));
    if (missing.length === 0) return false;
    const lead = current.length && !current.endsWith('\n') ? '\n' : '';
    appendFileSync(excludePath, `${lead}${GIT_EXCLUDE_MARKER}\n${missing.join('\n')}\n`);
    return true;
  } catch {
    return false; // never let a git-metadata hiccup break state-dir resolution
  }
}

/** Test hook: forget memoized decisions. */
export function resetCortexStateDirCache(): void {
  cache.clear();
  warned.clear();
}

/** Convenience: `<stateDir>/<...segments>` for the given project. */
export function cortexStatePath(projectPath: string | undefined, ...segments: string[]): string {
  return join(resolveCortexStateDir(projectPath).dir, ...segments);
}

/** True if the directory exists and is writable by this process (used by writers that must stay best-effort). */
export function isWritableDir(dir: string): boolean {
  return existsSync(dir) && probeWritable(dir) === null;
}
