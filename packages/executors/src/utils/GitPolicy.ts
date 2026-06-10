/**
 * GitPolicy — single source of truth for git/PR access control + safe subprocess wiring.
 *
 * Used by PRAgentTool, WorkspaceManagerTool, and the server's /v1/pr/* routes so that
 * repo/action allow-listing, input validation, and token handling are consistent and
 * defined in exactly one place.
 *
 * Security posture:
 *  - Validation (repo/branch/prNumber regexes) is ALWAYS enforced — there is no opt-out.
 *    Combined with execFile (no shell), this closes the shell/argument-injection class.
 *  - The repo/action allow-list is opt-in defense-in-depth. Unset GIT_ALLOWED_REPOS means
 *    "allow all" (with a one-time startup warning) so existing single-user setups keep
 *    working after an upgrade; multi-tenant/shared deployments set it to restrict.
 *  - The auth token is exposed to gh/git ONLY through the subprocess environment
 *    (GH_TOKEN / GITHUB_TOKEN). It is never interpolated into argv or a clone URL.
 *
 * Env vars (see SettingsSchema.ts / .env.example):
 *  - GIT_ALLOWED_REPOS    comma list of owner/repo, supports `owner/*` and `*`. Default `*`.
 *  - GIT_ALLOWED_ACTIONS  comma list of actions. Default: all actions allowed.
 *  - GIT_AUTH_TOKEN       token for gh/git, injected into the subprocess env only.
 *  - GIT_HOST             GitHub (Enterprise) host, default `github.com`.
 */

export type GitAction =
  | 'review'
  | 'list'
  | 'create'
  | 'post-review'
  | 'clone'
  | 'worktree'
  | 'diff'
  | 'cleanup'
  | 'status';

export const ALL_GIT_ACTIONS: GitAction[] = [
  'review',
  'list',
  'create',
  'post-review',
  'clone',
  'worktree',
  'diff',
  'cleanup',
  'status',
];

export interface GitPolicyConfig {
  /** Raw GIT_ALLOWED_REPOS value (comma list of owner/repo, `owner/*`, or `*`). */
  allowedRepos?: string;
  /** Raw GIT_ALLOWED_ACTIONS value (comma list). Unset → all actions allowed. */
  allowedActions?: string;
  /** GIT_AUTH_TOKEN — injected into subprocess env as GH_TOKEN/GITHUB_TOKEN. */
  token?: string;
  /** GIT_HOST — GitHub Enterprise host. Default `github.com`. */
  host?: string;
}

// First char must be alphanumeric (blocks leading `-` argument injection on both halves);
// remainder limited to word chars, dot, dash. No slashes beyond the single owner/repo one,
// no shell metacharacters, no whitespace.
const REPO_RE = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;
// Conservative git ref-name rule: no leading dash, no `..`, no whitespace or shell/ref
// metacharacters. Allows nested refs like `feature/foo-bar`.
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

let warnedAllowAll = false;

export class GitPolicy {
  /** Parsed allow-list patterns: `*`, `owner/*`, or exact `owner/repo`. */
  private readonly repoPatterns: string[];
  /** Allowed actions, or null when all actions are permitted. */
  private readonly actions: Set<string> | null;
  readonly token?: string;
  readonly host: string;

  constructor(cfg: GitPolicyConfig = {}) {
    const reposRaw = (cfg.allowedRepos ?? '').trim();
    if (reposRaw === '' || reposRaw === '*') {
      this.repoPatterns = ['*'];
      if (reposRaw === '' && !warnedAllowAll) {
        warnedAllowAll = true;
        console.warn(
          '[WARN] GIT_ALLOWED_REPOS is unset — all repositories are permitted for git/PR tools. ' +
            'Set it to a comma list (e.g. "me/app,me/*") to restrict access.',
        );
      }
    } else {
      this.repoPatterns = reposRaw
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);
    }

    const actionsRaw = (cfg.allowedActions ?? '').trim();
    this.actions =
      actionsRaw === '' || actionsRaw === '*'
        ? null
        : new Set(
            actionsRaw
              .split(',')
              .map((a) => a.trim().toLowerCase())
              .filter(Boolean),
          );

    this.token = cfg.token && cfg.token.trim() !== '' ? cfg.token.trim() : undefined;
    this.host = (cfg.host && cfg.host.trim() !== '' ? cfg.host.trim() : 'github.com').toLowerCase();
  }

  /** Build a policy from environment variables (defaults to process.env). */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): GitPolicy {
    return new GitPolicy({
      allowedRepos: env.GIT_ALLOWED_REPOS,
      allowedActions: env.GIT_ALLOWED_ACTIONS,
      token: env.GIT_AUTH_TOKEN,
      host: env.GIT_HOST,
    });
  }

  /**
   * Validate a repo string: format first (blocks injection), then the allow-list.
   * Returns an error message, or null when the repo is acceptable.
   */
  validateRepo(repo: unknown): string | null {
    if (typeof repo !== 'string' || repo.trim() === '') {
      return 'repo is required and must be a string in "owner/repo" format';
    }
    const value = repo.trim();
    if (!REPO_RE.test(value)) {
      return `repo "${value}" is not a valid "owner/repo" identifier (only letters, digits, ., _, - allowed; no shell metacharacters)`;
    }
    if (!this.isRepoAllowed(value)) {
      return `repo "${value}" is not in the GIT_ALLOWED_REPOS allow-list`;
    }
    return null;
  }

  /** True if the (already format-valid) repo matches the allow-list. */
  isRepoAllowed(repo: string): boolean {
    const value = repo.trim().toLowerCase();
    for (const pattern of this.repoPatterns) {
      if (pattern === '*') return true;
      if (pattern === value) return true;
      if (pattern.endsWith('/*')) {
        const owner = pattern.slice(0, -2);
        if (value.startsWith(owner + '/')) return true;
      }
    }
    return false;
  }

  /** Validate a branch / ref name. Returns an error message or null. */
  validateBranch(name: unknown): string | null {
    if (name === undefined || name === null || name === '') return null; // optional
    if (typeof name !== 'string' || !BRANCH_RE.test(name) || name.includes('..')) {
      return `branch "${String(name)}" is not a valid git ref name`;
    }
    return null;
  }

  /** Validate a PR number (must be a positive integer). Returns an error message or null. */
  validatePrNumber(n: unknown): string | null {
    const num = typeof n === 'string' && /^\d+$/.test(n) ? Number(n) : n;
    if (!Number.isInteger(num) || (num as number) <= 0) {
      return `prNumber "${String(n)}" must be a positive integer`;
    }
    return null;
  }

  /** Coerce a validated PR number to an integer (call only after validatePrNumber passes). */
  prNumber(n: unknown): number {
    return typeof n === 'string' ? Number(n) : (n as number);
  }

  isActionAllowed(action: GitAction): boolean {
    return this.actions === null || this.actions.has(action);
  }

  /** Returns an error message if the action is blocked, else null. */
  assertAction(action: GitAction): string | null {
    return this.isActionAllowed(action)
      ? null
      : `action "${action}" is not in the GIT_ALLOWED_ACTIONS allow-list`;
  }

  /**
   * Subprocess environment with the auth token + host injected for gh/git.
   * The token rides in env only — never on argv or in a URL.
   */
  subprocessEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...base };
    if (this.token) {
      env.GH_TOKEN = this.token;
      env.GITHUB_TOKEN = this.token;
    }
    if (this.host && this.host !== 'github.com') {
      env.GH_HOST = this.host;
    }
    return env;
  }

  /** HTTPS clone URL for an `owner/repo`, host-aware. No token embedded. */
  cloneUrl(repo: string): string {
    return `https://${this.host}/${repo}.git`;
  }
}
