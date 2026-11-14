import { realpathSync } from 'fs';
// Stale-server detection (2026-11-14, m2 battery C5/C7): the CLI attached to a server started before `cortex update` and the turn ran
// OLD code silently. Pure helpers so the policy is unit-tested (tests/unit/staleServer.test.ts); used by bin/cortex.js ensureServer().
const parse = (v) => String(v ?? '').split('-')[0].split('.').map((n) => Number.parseInt(n, 10));

/** True when the running server is older than this CLI (or reports no / the legacy hard-coded '4.0.0' version). */
export function isStaleServer(serverVersion, cliVersion) {
  const c = parse(cliVersion);
  if (c.length < 3 || c.some(Number.isNaN)) return false;           // unknown CLI version: never force a restart
  const s = parse(serverVersion);
  if (s.length < 3 || s.some(Number.isNaN)) return true;
  for (let i = 0; i < 3; i++) { if (s[i] !== c[i]) return s[i] < c[i]; }
  return false;
}

/** CORTEX_STALE_SERVER = restart (default) | warn | fail. */
export function staleServerPolicy(env = process.env) {
  const v = String(env.CORTEX_STALE_SERVER ?? '').trim().toLowerCase();
  return v === 'warn' || v === 'fail' ? v : 'restart';
}

/** True when the running server is bound to a DIFFERENT project directory than the caller's cwd (memory, files and sessions would land in
 *  the server's project — m2 battery C4). Unknown server project → false (an old server is caught by the version check instead). */
export function wrongProject(serverProject, cwd) {
  if (!serverProject || !cwd) return false;
  const norm = (p) => { let r = String(p); try { r = realpathSync(r); } catch { /* keep as given */ } return r.replace(/\/+$/, '') || '/'; };
  return norm(serverProject) !== norm(cwd);
}
