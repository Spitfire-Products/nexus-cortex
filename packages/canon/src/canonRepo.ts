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
