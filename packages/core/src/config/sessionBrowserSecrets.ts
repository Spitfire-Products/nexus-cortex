/**
 * sessionBrowserSecrets — the library behind `cortex browser-secrets` and the TUIs' /sessions menu (vault tasks T3 + T4).
 *
 * Operations, all METADATA ONLY:
 *   listBrowserSecrets()          → per site: site, cookieCount, importedAt, expiresAt?, expired, grant ('none' | 'session' | 'always')
 *   grantBrowserSecret(site, s)   → 'always' (standing, bound to the CURRENT vault entry), 'session' (this process + this session only),
 *                                   'none' (clears both). The person at the menu IS the consent — this is how a site is granted ahead of a
 *                                   scheduled task (the floor then loads it with nobody asked; operator 11-14).
 *   revokeBrowserSecret(site)     → removes the vault entry AND every grant
 *
 * A cookie value, a storage value or any other secret never appears in a return value, in a thrown error or in a log line: these read
 * `listSites()` (the plaintext metadata the store keeps outside the encrypted payload) and the grant file (mode + time). None needs the
 * vault key, so they work locked.
 *
 * 'session' grants live in PROCESS MEMORY and are bound to a session id (sessionRelease.ts). A caller in the agent process (the TUI menu)
 * passes its session id; a separate CLI process cannot see or make one, so it reports and grants 'none' / 'always' only.
 */
import { listSites, sessionVaultPath, type SiteSummary } from './sessionVault.js';
import {
  readGrantForSite, grantsPath, setGrant, clearGrant, revokeSessionSite, hasSessionGrant, addSessionGrant, clearSessionGrantsForSite, expiryState,
  type RevokeResult,
} from './sessionRelease.js';

export type BrowserSecretGrant = 'none' | 'session' | 'always';
export interface BrowserSecretRow {
  site: string; cookieCount: number; importedAt: number; expiresAt?: number; expired: boolean; grant: BrowserSecretGrant;
  /** within SESSION_EXPIRY_WARN_DAYS of its latest real cookie expiry (operator 11-16 early warning) */
  expiringSoon: boolean;
  /** last write-back of the browser's refreshed cookies (epoch ms) */
  refreshedAt?: number;
}
export interface BrowserSecretsOptions {
  vaultFile?: string; grantsFile?: string; env?: NodeJS.ProcessEnv;
  /** The agent session the caller runs in — needed to see or make a 'session' grant (TUI menu). */
  sessionId?: string;
  /** Clock seam (tests). */
  now?: number;
}

function rowFor(s: SiteSummary, opts: BrowserSecretsOptions): BrowserSecretRow {
  const g = readGrantForSite(s.site, opts.grantsFile ?? grantsPath());
  const always = g?.mode === 'always' && g.importedAt === s.importedAt;   // a grant for an older import is stale: not reported as a grant
  const session = !always && hasSessionGrant(s.site, s.importedAt, opts.sessionId);
  const now = opts.now ?? Date.now();
  const row: BrowserSecretRow = {
    site: s.site, cookieCount: s.cookieCount, importedAt: s.importedAt,
    expired: typeof s.expiresAt === 'number' && s.expiresAt > 0 && s.expiresAt * 1000 < now,
    expiringSoon: expiryState(s.expiresAt, now) === 'expiring',
    grant: always ? 'always' : session ? 'session' : 'none',
  };
  if (typeof s.expiresAt === 'number') row.expiresAt = s.expiresAt;
  if (typeof s.refreshedAt === 'number') row.refreshedAt = s.refreshedAt;
  return row;
}

/** What is stored, per site. Metadata only — never a cookie or a storage value. */
export function listBrowserSecrets(opts: BrowserSecretsOptions = {}): BrowserSecretRow[] {
  return listSites(opts.vaultFile ?? sessionVaultPath()).map((s) => rowFor(s, opts));
}

/**
 * Set a site's grant from a person at the menu or the CLI. Refuses a site that is not in the vault (there is nothing to grant), and
 * refuses 'session' without a sessionId (it could never be honoured — fail closed, never silently 'always').
 */
export function grantBrowserSecret(site: string, scope: BrowserSecretGrant, opts: BrowserSecretsOptions = {}): BrowserSecretRow {
  const key = String(site ?? '').trim().toLowerCase();
  const entry = listSites(opts.vaultFile ?? sessionVaultPath()).find((x) => x.site === key);
  if (!entry) throw new Error(`no saved sign-in for ${key || '(empty site)'} — import one first`);
  const grantsFile = opts.grantsFile ?? grantsPath();
  if (scope === 'always') {
    clearSessionGrantsForSite(key);
    setGrant(key, opts.now ?? Date.now(), entry.importedAt, grantsFile);
  } else if (scope === 'session') {
    if (!opts.sessionId || !opts.sessionId.trim()) throw new Error('a "this session" grant needs the running agent session (use the TUI /sessions menu)');
    clearGrant(key, grantsFile);
    addSessionGrant(key, entry.importedAt, opts.sessionId);
  } else if (scope === 'none') {
    clearGrant(key, grantsFile);
    clearSessionGrantsForSite(key);
  } else {
    throw new Error(`unknown grant "${String(scope)}": use always, session or none`);
  }
  return rowFor(entry, opts);
}

/** Remove a site completely: vault entry + every grant. Prints nothing, returns only what was removed (booleans, never values). */
export async function revokeBrowserSecret(site: string, opts: BrowserSecretsOptions = {}): Promise<RevokeResult> {
  return revokeSessionSite(site, {
    ...(opts.vaultFile !== undefined ? { vaultFile: opts.vaultFile } : {}),
    ...(opts.grantsFile !== undefined ? { grantsFile: opts.grantsFile } : {}),
  });
}
