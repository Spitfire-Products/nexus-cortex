/**
 * Where the canon store working clone lives when no `--store` is given (nexus-canon 1.12.0).
 *
 * Order:
 *   1. `CANON_STORE` — env, or `cortex config set CANON_STORE <dir>`;
 *   2. an existing `/tmp/canon-store` — the pre-1.12 default, still used when it is there so current installs (and the hosted
 *      container) keep their clone;
 *   3. `$XDG_CACHE_HOME/nexus-canon/store`, else `~/.cache/nexus-canon/store` — on disk, survives reboots.
 *
 * Why not /tmp any more: /tmp is RAM-backed tmpfs on many systems (Debian 13, Fedora, Arch; Replit since 2026-10) and is wiped at
 * boot, so a multi-GB clone there costs that much RAM and a full re-clone after every restart. The old reason for /tmp was one
 * host's workspace disk quota; a cache directory is the right default everywhere else.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The pre-1.12 default location. */
export const LEGACY_CANON_STORE = '/tmp/canon-store';

export function defaultCanonStore(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CANON_STORE?.trim();
  if (configured) return configured;
  if (existsSync(LEGACY_CANON_STORE)) return LEGACY_CANON_STORE;
  const cache = env.XDG_CACHE_HOME?.trim() || join(homedir(), '.cache');
  return join(cache, 'nexus-canon', 'store');
}
