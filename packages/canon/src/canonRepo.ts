/**
 * canonRepo — resolve the canon store's remote URL, fail-fast when unconfigured,
 * and the ONE shared git exec every canon verb must use (`canonGit`).
 *
 * There is deliberately NO built-in default remote: a canon store is the USER'S
 * repo. Auto-clone only ever targets an explicitly configured remote
 * (`--repo-url` / `repoUrl` option, or the `CANON_REPO` env var). An
 * unconfigured environment gets a clear actionable error instead of an attempted
 * clone of someone else's store URL.
 *
 * @module canon/canonRepo
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';

/** The remote URL if configured (explicit option wins over CANON_REPO env), else null. */
export function resolveCanonRepo(explicit?: string): string | null {
  return explicit ?? process.env.CANON_REPO ?? null;
}

/**
 * Resolve the remote for an auto-clone, or throw a clear error. Call ONLY when a
 * clone is actually needed (no store at `storePath`) — an existing store never
 * needs this; its `origin` is the truth.
 */
export function requireCanonRepo(explicit: string | undefined, storePath: string, label = 'canon'): string {
  const url = resolveCanonRepo(explicit);
  if (!url) {
    throw new Error(
      `[${label}] no canon store at ${storePath} and no remote configured — ` +
      'run `canon init <dir> --remote <your-repo-url>` to scaffold a store, ' +
      'or set CANON_REPO / pass --repo-url to auto-clone an existing one',
    );
  }
  return url;
}

/**
 * Strip any embedded credential from a git URL before it is logged. Turns
 * `https://x-access-token:<TOKEN>@github.com/owner/repo` into
 * `https://***@github.com/owner/repo`. Defense-in-depth: the token should not be
 * in the URL at all (it rides in GH_TOKEN + http.extraheader), but any URL that
 * still carries one must never reach a log line, PTY, or captured transcript.
 */
export function redactRepoUrl(url: string): string {
  return url.replace(/\/\/[^/@]*@/, '//***@');
}

/**
 * Per-invocation git auth: the token rides in env (GH_TOKEN/GITHUB_TOKEN) and is
 * applied via http.extraheader — never embedded in the clone URL, .git/config,
 * argv, or a log line. Empty when no token is set (public repo / ambient creds).
 */
export function gitAuthArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN || '';
  return token
    ? ['-c', `http.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`]
    : [];
}

/**
 * Per-invocation commit identity, so a container with no global git identity
 * (hosted sandbox: `root@cloudchamber.(none)`) can still commit — fixes the
 * 'Author identity unknown' failure that hit every commit site EXCEPT canon-sync
 * (2026-08-13: translate + graph both leaked it to the hosted PTY).
 */
export function gitIdArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    '-c', `user.email=${env.CANON_GIT_EMAIL || 'canon-sync@nexus-cortex.local'}`,
    '-c', `user.name=${env.CANON_GIT_NAME || 'nexus-cortex canon-sync'}`,
  ];
}

/**
 * THE git exec for canon verbs. Every invocation carries auth + identity, and —
 * critically — pipes stdio: an unpiped child inherits the process's fd 2, so its
 * stderr bypasses the CANON_LOG_FILE console swap (canonSyncScheduler.runQuietly)
 * and corrupts the interactive TUI. On failure the redacted last stderr line is
 * surfaced via console.error (routed to the log file in hosted mode) and the
 * error rethrown for the caller's own handling.
 *
 * `cwd` null = repo-less commands (clone). Use this — never a bare execFileSync.
 */
export function canonGit(cwd: string | null, label: string): (args: string[]) => string {
  return (args: string[]): string => {
    try {
      return execFileSync('git', [...gitAuthArgs(), ...gitIdArgs(), ...args], {
        ...(cwd ? { cwd } : {}),
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      const stderr = redactRepoUrl(String((e as { stderr?: string }).stderr ?? (e as Error).message ?? e));
      const verb = args.find((a) => !a.startsWith('-')) ?? args[0];
      console.error(`[${label}] git ${verb} FAILED: ${stderr.trim().split('\n').pop()}`);
      throw e;
    }
  };
}

/**
 * Guarded stage-everything: `git add -A` + refuse to proceed when the staged
 * set contains a MASS DELETION. Canon verbs append and update; none has a
 * legitimate reason to delete more than a handful of paths in one pass — a
 * large staged-deletion set means the working tree is a partial clone/checkout
 * (the 2026-08-18 + 2026-08-20 incidents: a /tmp-reaped store was re-cloned /
 * operated on mid-checkout, `git add -A` staged every missing file as deleted,
 * and the commit message still read "N file(s) updated"). Every canon commit
 * path (sync/translate/graph/artifacts) MUST stage through this helper.
 * Returns true when it is safe to commit; false = staged set was reset,
 * nothing may be committed this pass.
 */
export function guardedAddAll(git: (args: string[]) => string, label: string, maxDeletes = 10): boolean {
  git(['add', '-A']);
  const status = git(['status', '--porcelain']);
  const stagedDeletes = status.split('\n').filter((l) => /^D /.test(l)).length;
  if (stagedDeletes > maxDeletes) {
    console.error(
      `[${label}] ABORT: ${stagedDeletes} staged deletions — a canon verb never mass-deletes. ` +
      'Working tree is likely a partial clone/checkout; nothing committed.',
    );
    git(['reset', '-q']);
    return false;
  }
  return status.trim().length > 0;
}

/**
 * Multi-writer-safe push: push main; on rejection (a concurrent writer —
 * another machine, a bench-worker fleet, watcher+cron overlap — landed
 * first) `pull --rebase` and retry. Canon writers are append-only over
 * mostly-disjoint files, so rebase is the correct recovery; a REAL
 * conflict aborts the rebase and returns false — never force, never leave
 * the clone mid-rebase (the next cycle must find a clean, usable tree;
 * the local commit is preserved and re-tried then). Every canon push path
 * (sync/translate/graph/artifacts) routes through this.
 */
export function guardedPush(git: (args: string[]) => string, label: string, maxAttempts = 3): boolean {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      git(['push', '-q', 'origin', 'main']);
      return true;
    } catch {
      // rejected — try to land on top of the concurrent writer's commit
    }
    try {
      git(['pull', '--rebase', '-q', 'origin', 'main']);
      console.log(`[${label}] push rejected by a concurrent writer — rebased, retrying (${attempt}/${maxAttempts})`);
    } catch {
      try { git(['rebase', '--abort']); } catch { /* no rebase in progress */ }
      console.error(`[${label}] push retry ${attempt}/${maxAttempts}: rebase CONFLICT — aborted, local commit kept for next cycle`);
      return false;
    }
  }
  console.error(`[${label}] push FAILED after ${maxAttempts} rebase-retry attempts (remote advancing faster than retries)`);
  return false;
}

/**
 * Atomic clone: clone into a sibling temp dir, then rename into place. The
 * store path NEVER contains a `.git` over a partially-checked-out tree, so a
 * concurrent canon verb either sees no store (and clones/waits itself) or a
 * COMPLETE one — the mid-checkout race that fed both mass-deletion incidents
 * is structurally closed. Cleans up the temp dir on failure.
 */
export function atomicClone(repoUrl: string, storePath: string, label: string): void {
  const tmp = `${storePath}.cloning-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    execFileSync('git', [...gitAuthArgs(), 'clone', '-q', repoUrl, tmp], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // A racing process may have completed its own clone while ours ran — keep
    // theirs (it is complete by the same invariant) and discard ours.
    if (fs.existsSync(`${storePath}/.git`)) {
      fs.rmSync(tmp, { recursive: true, force: true });
      return;
    }
    fs.renameSync(tmp, storePath);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    const stderr = redactRepoUrl(String((e as { stderr?: string }).stderr ?? (e as Error).message ?? e));
    console.error(`[${label}] clone FAILED: ${stderr.trim().split('\n').pop()}`);
    throw e;
  }
}
