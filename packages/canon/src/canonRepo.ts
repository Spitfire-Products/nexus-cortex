/**
 * canonRepo — resolve the canon store's remote URL, fail-fast when unconfigured.
 *
 * There is deliberately NO built-in default remote: a canon store is the USER'S
 * repo. Auto-clone only ever targets an explicitly configured remote
 * (`--repo-url` / `repoUrl` option, or the `CANON_REPO` env var). An
 * unconfigured environment gets a clear actionable error instead of an attempted
 * clone of someone else's store URL.
 *
 * @module canon/canonRepo
 */

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
