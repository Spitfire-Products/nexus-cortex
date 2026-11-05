/**
 * EvalGuard — keep the Fixer away from the evaluation (autoresearch hardening A1).
 *
 * The statistical gate can only be trusted if the thing being improved cannot reach
 * the thing that grades it. Library home of the three mechanisms, so every entry point
 * can apply them (the CLI `cortex autoresearch loop` applies all three):
 *
 *  1. SEAL — the train/holdout task-sets are copied ONCE, at loop start, into a private
 *     temp dir outside the repo, and every experiment grades against those sealed copies.
 *     Editing the in-repo task-set (or the main checkout) changes nothing the gate reads.
 *  2. HIDE — a task-set that lives inside the repo is deleted from each candidate worktree
 *     before the Fixer runs and restored to the base version before the candidate is
 *     committed, so the Fixer neither reads it in the tree nor ships an edit to it.
 *     (Best-effort secrecy: the files are still in git history. For a holdout the Fixer
 *     must never see, keep it OUTSIDE the repo; the loop warns when it is inside.)
 *  3. REFUSE — before a candidate is benched, its changed paths are checked against the
 *     protected globs (verifier scripts, graders, benches: `--protect`) and the optional
 *     editable allowlist (`--editable`). A candidate that touches a protected path or
 *     strays outside the allowlist is refused unbenched (`skipped: 'eval-guard'`).
 *
 * Pure helpers + small fs helpers; no git here (the caller owns git).
 */
import { createHash } from 'node:crypto';
import { cpSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, sep } from 'node:path';

/** Convert a glob to an anchored RegExp over repo-relative POSIX paths.
 *  `**` matches across directories (and `dir/**` also matches `dir` itself), `*` and `?`
 *  stay inside one path segment. A glob with no slash matches the basename at any depth. */
export function globToRegExp(glob: string): RegExp {
  let g = glob.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!g.includes('/')) g = `**/${g}`;
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === '*') {
      if (g[i + 1] === '*') {
        const slashAfter = g[i + 2] === '/';
        re += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  // `dir/**` also covers the directory path itself.
  if (re.endsWith('/.*')) re = `${re.slice(0, -3)}(?:/.*)?`;
  return new RegExp(`^${re}$`);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  const p = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return globs.some((g) => globToRegExp(g).test(p));
}

export interface GuardViolation {
  path: string;
  rule: 'protected' | 'outside-editable';
}

export interface GuardPolicy {
  /** globs no candidate may touch (the task-sets' in-repo paths are added by the loop). */
  protect: readonly string[];
  /** when non-empty, every changed path must match one of these. */
  editable?: readonly string[];
}

/** Check a candidate's changed paths (repo-relative, POSIX) against the policy. */
export function checkCandidateChanges(changed: readonly string[], policy: GuardPolicy): { ok: boolean; violations: GuardViolation[] } {
  const violations: GuardViolation[] = [];
  const editable = policy.editable ?? [];
  for (const path of changed) {
    if (matchesAny(path, policy.protect)) violations.push({ path, rule: 'protected' });
    else if (editable.length && !matchesAny(path, editable)) violations.push({ path, rule: 'outside-editable' });
  }
  return { ok: violations.length === 0, violations };
}

/** One-line human summary of the violations (capped). */
export function describeViolations(v: readonly GuardViolation[], max = 5): string {
  const head = v.slice(0, max).map((x) => `${x.path} (${x.rule})`).join(', ');
  return v.length > max ? `${head}, +${v.length - max} more` : head;
}

/** The repo-relative POSIX path of `absPath` when it lies inside `repoDir`, else undefined. */
export function repoRelative(absPath: string, repoDir: string): string | undefined {
  const rel = relative(repoDir, absPath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return rel.split(sep).join('/');
}

/** Glob that protects a task-set path (a file, or every file under a directory). */
export function protectGlobFor(relPath: string, isDir: boolean): string {
  return isDir ? `${relPath.replace(/\/+$/, '')}/**` : relPath;
}

/** sha256 over a file, or over a directory's files (sorted relative path + content). */
export function hashPath(p: string): string {
  const h = createHash('sha256');
  const walk = (abs: string, rel: string) => {
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs).sort()) walk(join(abs, name), rel ? `${rel}/${name}` : name);
    } else {
      h.update(`${rel}\0`);
      h.update(readFileSync(abs));
      h.update('\0');
    }
  };
  walk(p, '');
  return h.digest('hex');
}

export interface SealedSet {
  /** where the loop read it from */
  source: string;
  /** the private copy every experiment grades against */
  sealed: string;
  sha256: string;
  isDir: boolean;
  /** repo-relative path when the source lies inside the repo (then it is hidden + protected) */
  inRepo?: string;
}

/** Copy a task-set (file or dir) into `sealDir/<label>-<basename>` and fingerprint it. */
export function sealTaskSet(source: string, sealDir: string, label: string, repoDir: string): SealedSet {
  const isDir = statSync(source).isDirectory();
  const sealed = join(sealDir, `${label}-${basename(source)}`);
  cpSync(source, sealed, { recursive: true });
  return { source, sealed, sha256: hashPath(sealed), isDir, inRepo: repoRelative(source, repoDir) };
}

/** Task ids declared in a task-set (file or dir of *.json; array or single object). */
export function taskIdsIn(p: string): Set<string> {
  const ids = new Set<string>();
  const files = statSync(p).isDirectory()
    ? readdirSync(p).filter((f) => f.endsWith('.json')).map((f) => join(p, f))
    : [p];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(f, 'utf8'));
      for (const t of Array.isArray(raw) ? raw : [raw]) if (t && typeof t.id === 'string') ids.add(t.id);
    } catch { /* unreadable file: the experiment reports it */ }
  }
  return ids;
}
