/**
 * repoResolve — turn a `--repo`/`--base-dir` value into a usable local checkout, and
 * resolve task-set paths against it.
 *
 * The autoresearch CLI accepts either a LOCAL path (today's behaviour) or a PUBLIC
 * http(s) git URL. For a URL we shallow-clone it credential-free into a stable temp
 * dir and reuse the clone on subsequent calls (idempotent). PUBLIC repos only — no
 * token/credential handling is added here on purpose.
 *
 * `resolveTaskSet` lets a caller reference a task-set that lives INSIDE the repo: when
 * the task-set path is relative and a repo dir is given, it resolves against the
 * checkout dir. Absolute paths are returned unchanged.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/** True when `value` looks like a PUBLIC http(s) git URL (not a local path). */
export function isRemoteRepo(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Resolve a `--repo`/`--base-dir` value to a local checkout dir.
 *  - Local path → absolute path, unchanged behaviour.
 *  - Public http(s) URL → shallow clone (`git clone --depth=50`, no credentials) into a
 *    deterministic temp dir keyed by the URL, reusing an existing clone if present.
 */
export function resolveRepoDir(value: string, log?: (m: string) => void): string {
  if (!isRemoteRepo(value)) return resolve(value);

  const key = createHash('sha1').update(value).digest('hex').slice(0, 16);
  const dir = join(tmpdir(), `arrepo-${key}`);

  // Reuse an existing clone (idempotent): a valid git checkout at the keyed dir is left as-is.
  if (existsSync(join(dir, '.git'))) {
    log?.(`reuse clone ${dir} (${value})`);
    return dir;
  }

  mkdirSync(tmpdir(), { recursive: true });
  log?.(`clone ${value} → ${dir}`);
  execFileSync('git', ['clone', '--depth=50', value, dir], {
    stdio: ['ignore', 'ignore', 'pipe'],
    // Hard-disable any interactive credential/host prompt: PUBLIC repos only.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return dir;
}

/**
 * Resolve a task-set/holdout-set path. Relative paths are resolved against `repoDir`
 * when one is given (so a caller can reference a task-set inside the repo, e.g.
 * `.cortex/bench/tasks/x.json`); absolute paths are returned unchanged.
 */
export function resolveTaskSet(taskSet: string, repoDir?: string): string {
  if (isAbsolute(taskSet)) return taskSet;
  if (repoDir) return resolve(repoDir, taskSet);
  return resolve(taskSet);
}
