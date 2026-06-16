/**
 * Update check + self-update for the globally-installed CLI.
 *
 * This is the ONE canonical home for npm-package lifecycle. It can't live in core —
 * core is the orchestration library and must stay install/npm agnostic — so it lives
 * in the CLI package and every entry point calls the same functions (no per-bin flags).
 *
 * Behaviour is driven by the canonical CORTEX_UPDATE_POLICY setting:
 *   auto  → warn when interactive (TTY), error when programmatic (no TTY)   [default]
 *   off   → never check
 *   warn  → print a one-line notice, continue
 *   error → print + exit non-zero (75/EX_TEMPFAIL) so a programmatic caller must update
 *   force → auto-update, then exit so the caller re-invokes on the new version
 *
 * The registry is checked at most hourly (TTL cache in ~/.cortex/.update-check), so a
 * tight programmatic loop does not hammer npm. Every path is best-effort and must never
 * throw — a check failure can never break the CLI.
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getGlobalConfigDir, getGlobalEnvPath } from '@nexus-cortex/core';

const PKG_NAME = 'nexus-cortex'; // the meta package users install
const REGISTRY = `https://registry.npmjs.org/${PKG_NAME}/latest`;
const CHECK_TTL_MS = 60 * 60 * 1000; // re-check the registry at most hourly
const CACHE_PATH = join(getGlobalConfigDir(), '.update-check');

export type UpdatePolicy = 'off' | 'warn' | 'error' | 'force';

export function getCurrentVersion(): string | null {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version || null;
  } catch {
    return null;
  }
}

export function semverGt(a: string, b: string): boolean {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const https = await import('node:https');
    return await new Promise((resolve) => {
      const req = https.get(REGISTRY, { timeout: 3000 }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => { try { resolve(JSON.parse(body).version); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  } catch {
    return null;
  }
}

interface UpdateCache { lastCheck?: number; latest?: string | null; }

function readCache(): UpdateCache {
  try { return JSON.parse(readFileSync(CACHE_PATH, 'utf8')); } catch { return {}; }
}
function writeCache(c: UpdateCache): void {
  try { mkdirSync(dirname(CACHE_PATH), { recursive: true }); writeFileSync(CACHE_PATH, JSON.stringify(c)); } catch { /* ignore */ }
}

/** Lightweight policy read (avoids constructing SettingsLoader + its startup logging). */
function readPolicyRaw(): string {
  if (process.env.CORTEX_UPDATE_POLICY) return process.env.CORTEX_UPDATE_POLICY;
  try {
    const p = getGlobalEnvPath();
    if (existsSync(p)) {
      const m = readFileSync(p, 'utf8').match(/^CORTEX_UPDATE_POLICY=(.*)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* fall through to default */ }
  return 'auto';
}

/** Resolve the effective policy: 'auto' → warn when interactive, error when programmatic. */
export function resolvePolicy(): UpdatePolicy {
  const raw = readPolicyRaw();
  if (raw === 'auto') return process.stdout.isTTY ? 'warn' : 'error';
  if (raw === 'off' || raw === 'warn' || raw === 'error' || raw === 'force') return raw;
  return 'warn';
}

/** Run the self-update (visible npm output). Returns true on success. */
export function runUpdate(): boolean {
  const res = spawnSync('npm', ['install', '-g', `${PKG_NAME}@latest`], { stdio: 'inherit' });
  if (res.status === 0) {
    writeCache({ lastCheck: Date.now(), latest: null });
    return true;
  }
  return false;
}

/**
 * Startup update check. Best-effort, gated by policy. Only runs for real global installs
 * (skips source/dev runs). Never throws.
 */
export async function checkForUpdate(): Promise<void> {
  try {
    const policy = resolvePolicy();
    if (policy === 'off') return;

    const current = getCurrentVersion();
    if (!current) return;
    // Only meaningful for an actual global install, not source/dev runs.
    if (!dirname(fileURLToPath(import.meta.url)).includes('node_modules')) return;

    let cache = readCache();
    const stale = !cache.lastCheck || Date.now() - cache.lastCheck > CHECK_TTL_MS;
    if (stale) {
      const latest = await fetchLatestVersion();
      cache = { lastCheck: Date.now(), latest: latest ?? cache.latest ?? null };
      writeCache(cache);
    }

    const latest = cache.latest;
    if (!latest || !semverGt(latest, current)) return; // up to date / unknown → proceed

    const msg = `nexus-cortex ${current} is out of date (latest ${latest}).`;

    if (policy === 'warn') {
      process.stderr.write(`\n  [update] available: ${current} -> ${latest} · run \`cortex update\`\n\n`);
      return;
    }

    if (policy === 'force') {
      process.stderr.write(`\n${msg} Auto-updating…\n\n`);
      if (runUpdate()) {
        process.stderr.write('\n[OK] Updated. Re-run your command on the new version.\n');
        process.exit(0);
      }
      process.stderr.write('\n[WARN] Auto-update failed; continuing on the current version.\n');
      return;
    }

    // policy === 'error' (default for non-interactive / programmatic use)
    process.stderr.write(
      `\n[update-required] ${msg}\n  Run: cortex update` +
      `   (or set CORTEX_UPDATE_POLICY=warn to allow running a stale version)\n\n`,
    );
    process.exit(75); // EX_TEMPFAIL — a distinct, retryable signal for orchestrators
  } catch {
    /* never let the update check break the CLI */
  }
}
