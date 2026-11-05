/**
 * Which browser the harness drives (NEXUS_BROWSER_MODE; operator policy 2026-11-03):
 *   hosted (default) — the hosted nexus-browser MCP (McpServerRegistry's http entry); nothing to install.
 *   local            — the @nexus-cortex/browser library on this machine, run as a stdio MCP server — ONLY when the package is installed
 *                      AND its installer recorded the core as ready (<tools home>/install.json). Otherwise hosted, with the reason, so a
 *                      broken or half-finished local install never leaves an agent without a browser.
 * The library is an optional, separately licensed package (AGPL-3.0-only OR commercial); core never imports it — it only finds its
 * server entry point.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

export interface BrowserBackend { mode: 'hosted' | 'local'; using: 'hosted' | 'local'; reason: string; serverJs?: string; packageDir?: string }

export const browserToolsHome = (env: NodeJS.ProcessEnv = process.env): string =>
  env.NEXUS_BROWSER_HOME ?? path.join(os.homedir(), '.nexus-cortex', 'browser');

/** The installed @nexus-cortex/browser package directory, or null. */
export function localBrowserPackageDir(): string | null {
  try { return path.dirname(createRequire(import.meta.url).resolve('@nexus-cortex/browser/package.json')); } catch { return null; }
}

/** resolveBrowserBackend for HOT paths (the per-tool web gate runs for every tool on every request): cached 5 s per mode/home. */
let cached: { key: string; at: number; value: BrowserBackend } | null = null;
export function resolveBrowserBackendCached(env: NodeJS.ProcessEnv = process.env): BrowserBackend {
  const key = `${env.NEXUS_BROWSER_MODE ?? ''}|${browserToolsHome(env)}`;
  if (cached && cached.key === key && Date.now() - cached.at < 5000) return cached.value;
  const value = resolveBrowserBackend(env);
  cached = { key, at: Date.now(), value };
  return value;
}

export function resolveBrowserBackend(env: NodeJS.ProcessEnv = process.env): BrowserBackend {
  const mode = String(env.NEXUS_BROWSER_MODE ?? '').trim().toLowerCase() === 'local' ? 'local' : 'hosted';
  if (mode === 'hosted') return { mode, using: 'hosted', reason: 'NEXUS_BROWSER_MODE is hosted (default)' };
  const dir = localBrowserPackageDir();
  if (!dir) return { mode, using: 'hosted', reason: 'the @nexus-cortex/browser package is not installed' };
  const serverJs = path.join(dir, 'dist', 'server.js');
  if (!fs.existsSync(serverJs)) return { mode, using: 'hosted', reason: `${serverJs} is missing (package not built)`, packageDir: dir };
  let ready = false;
  try { ready = JSON.parse(fs.readFileSync(path.join(browserToolsHome(env), 'install.json'), 'utf8'))?.ready?.core === true; } catch { /* no install yet */ }
  if (!ready) return { mode, using: 'hosted', reason: 'the local browser is not installed yet — run `cortex browser install`', packageDir: dir };
  return { mode, using: 'local', reason: 'local browser installed and ready', serverJs, packageDir: dir };
}
