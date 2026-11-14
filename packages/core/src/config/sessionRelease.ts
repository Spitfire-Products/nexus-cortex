/**
 * sessionRelease — releasing a vaulted browser session into a live page (vault task T2).
 *
 * The release path, end to end: a site is in the vault? → the permission system asks the user (once / this session / always
 * for this site / no) → the vault's decrypted cookies are handed to the browser with CDP `Network.setCookies`, mapped 1:1 →
 * the release is appended to the audit trail. Nothing else: this module imports no browser and no prompt UI. `cdp` is a
 * structural type and `ask` an injected callback, so the module moves into the browser package unchanged.
 *
 * What it never does: return a value, put a value in an error message, or put a value in the release log. The returned object
 * is `{ site, loaded }` and nothing more; a browser failure is rethrown as a generic message that drops the driver's own text
 * (a driver can echo the cookie it rejected).
 *
 * Grants: 'always' is remembered per site in `~/.cortex/session-vault-grants.json` (site → {mode, at, importedAt}, owner-only,
 * written atomically); 'session' only in this process's memory; 'once' and 'no' nothing. A grant is bound to the vault entry it
 * was answered for: it is honoured ONLY while that entry's `importedAt` is still the current one (a grant with no `importedAt`,
 * or with a different one, is stale — the user is asked again and a new answer overwrites it). It is also only ever honoured
 * AFTER the vault is re-checked, so a leftover grant for a revoked site can never release anything.
 *
 * Order is fail-closed: the release log is appended BEFORE `Network.setCookies`, so a log that cannot be written sends nothing
 * to the browser. Cookies already past their `expires` are dropped and never counted in `loaded`.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  listSites, getSiteForRelease, revokeSite, appendReleaseLog,
  sessionVaultPath, releaseLogPath,
  type ReleaseMode, type VaultCookie,
} from './sessionVault.js';

/** Same rule as SettingsLoader.getGlobalConfigDir (kept local, exactly as sessionVault.ts does). CORTEX_HOME relocates the
 *  directory for every surface and for tests. */
const getGlobalConfigDir = (): string => path.join(process.env.CORTEX_HOME || os.homedir() || process.cwd(), '.cortex');

export const SESSION_GRANTS_FILE = 'session-vault-grants.json';

/** `~/.cortex/session-vault-grants.json` — the standing 'always' grants. */
export const grantsPath = (): string => path.join(getGlobalConfigDir(), SESSION_GRANTS_FILE);

/** The only CDP surface this module needs: a session that can send a command. No puppeteer import, no browser type. */
export interface CdpLike { send(method: string, params?: Record<string, unknown>): Promise<unknown> }

/** What the user may answer. 'no' releases nothing. */
export type ReleaseAnswer = 'once' | 'session' | 'always' | 'no';
/** The injected approval callback (the harness passes its permission prompt; tests pass a stub). */
export type Ask = (prompt: string, options: readonly ReleaseAnswer[]) => Promise<ReleaseAnswer> | ReleaseAnswer;

/** What a release returns. Never a cookie, never a storage value — only how many cookies were loaded. */
export interface ReleaseResult { site: string; loaded: number }

/** A standing grant: the mode the user chose for this site, when, and the vault entry it was given for. */
export interface SiteGrant { mode: ReleaseMode; at: number; importedAt: number }
/** What the file may hold: a grant written by an older build has no `importedAt`, and such a grant is never honoured. */
interface GrantsFile { version: 1; grants: Record<string, Partial<SiteGrant>> }

/** Every file the release path writes is injectable; the defaults sit under the global config dir. */
export interface ReleaseOptions {
  ask: Ask;
  vaultFile?: string;
  logFile?: string;
  grantsFile?: string;
  env?: NodeJS.ProcessEnv;
  /** test seam / deterministic logs */
  now?: () => number;
  /** optional task id for the audit trail (sanitised by the store) */
  task?: string;
}

export interface RevokeOptions { vaultFile?: string; grantsFile?: string }
export interface RevokeResult { site: string; revoked: boolean; grantCleared: boolean }

// ── public suffixes (PARTIAL) ───────────────────────────────────────────────
/**
 * PARTIAL, deliberately: the real Public Suffix List is ~10k entries and would have to be vendored + refreshed. This is the
 * common multi-part set — the ones a session import actually meets — and every entry is a suffix that is NOT a registrable
 * domain on its own. 'example.co.uk' (a registrable domain) is accepted; 'co.uk' (the suffix) is refused. Anything not listed
 * is accepted, so the guard is a floor, not a promise: an unlisted suffix ('foo.bar') gets through.
 */
export const PUBLIC_SUFFIXES: readonly string[] = Object.freeze([
  // United Kingdom
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'net.uk', 'sch.uk', 'ltd.uk', 'plc.uk', 'me.uk',
  // Australia / New Zealand
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au', 'co.nz', 'net.nz', 'org.nz', 'govt.nz',
  // Japan / Korea / India / China
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp', 'co.kr', 'or.kr', 'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'com.hk', 'com.sg', 'com.tw',
  // Brazil / Mexico / South Africa / Spain / Italy
  'com.br', 'net.br', 'org.br', 'com.mx', 'org.mx', 'co.za', 'org.za', 'com.es', 'com.it',
  // Hosting / pages platforms (private suffixes: a subdomain is one tenant, never a site)
  'github.io', 'gitlab.io', 'herokuapp.com', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev',
  'blogspot.com', 'appspot.com', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'firebaseapp.com',
  'web.app', 'glitch.me', 'repl.co', 'ngrok.io', 'fly.dev', 'onrender.com', 'surge.sh',
]);

/** Is this host itself a public suffix (i.e. not a site anyone can own)? Exact match on the vendored list. */
export function isPublicSuffix(host: unknown): boolean {
  if (typeof host !== 'string') return false;
  const h = host.trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
  return PUBLIC_SUFFIXES.includes(h);
}

// ── validation ──────────────────────────────────────────────────────────────
/** A site is a bare registrable domain — the same rule the store applies, plus the public-suffix guard T1 left to this task. */
function assertSite(site: unknown): string {
  if (typeof site !== 'string' || !site.trim()) throw new Error('a site is required (the registrable domain, e.g. github.com)');
  const s = site.trim().toLowerCase();
  if (s.includes('/')) throw new Error(`invalid site "${site}": a site is a domain (e.g. github.com), not a URL or a path`);
  if (s.startsWith('.') || s.includes('..') || /\s/.test(s)) throw new Error(`invalid site "${site}": a site is a bare domain (e.g. github.com)`);
  if (!s.includes('.')) throw new Error(`invalid site "${site}": a site is a registrable domain with a dot (e.g. github.com), not a single label`);
  if (isPublicSuffix(s)) throw new Error(`refusing "${s}": it is a public suffix (a shared registry/platform domain), not a registrable domain someone owns`);
  return s;
}

function assertMode(mode: unknown): ReleaseMode {
  if (mode !== 'once' && mode !== 'session' && mode !== 'always') throw new Error(`invalid release mode "${String(mode)}": use once, session or always`);
  return mode;
}

// ── the grants file ─────────────────────────────────────────────────────────
function readGrants(file: string): GrantsFile {
  if (!fs.existsSync(file)) return { version: 1, grants: {} };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as GrantsFile;
    return { version: 1, grants: data?.grants && typeof data.grants === 'object' ? data.grants : {} };
  } catch { throw new Error(`the session vault grants file at ${file} is unreadable (not JSON) — refusing to touch it`); }
}

/** tmp + rename: a crash or a full disk never leaves a half-written grants file. Owner-only (0600) in a 0700 directory. */
export function writeGrants(data: GrantsFile, file = grantsPath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, grants: data.grants }, null, 1), { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}

/** The standing grant for a site, exactly as stored — mode, time and the vault entry it was given for. */
function readGrantRecord(site: string, file = grantsPath()): Partial<SiteGrant> | undefined {
  const g = readGrants(file).grants[assertSite(site)];
  return g && (g.mode === 'always' || g.mode === 'session' || g.mode === 'once') ? g : undefined;
}

/** The standing mode for a site, if the user ever chose 'always' for it. Metadata only — a mode and a timestamp. */
export function readGrant(site: string, file = grantsPath()): ReleaseMode | undefined {
  return readGrantRecord(site, file)?.mode;
}

/** Remember 'always' for a site — bound to the vault entry it was answered for (`importedAt`). */
export function setGrant(site: string, at: number, importedAt: number, file = grantsPath()): SiteGrant {
  const s = assertSite(site);
  const data = readGrants(file);
  const grant: SiteGrant = { mode: 'always', at, importedAt };
  data.grants[s] = grant;
  writeGrants(data, file);
  return grant;
}

/** Forget a site's grant. Returns whether there was one — nothing is written when there was not. */
export function clearGrant(site: string, file = grantsPath()): boolean {
  const s = assertSite(site);
  const data = readGrants(file);
  if (!data.grants[s]) return false;
  delete data.grants[s];
  writeGrants(data, file);
  return true;
}

// ── in-memory 'session' grants ──────────────────────────────────────────────
/** 'session' never reaches the disk: this process only. Exported so a caller (or a test) can start clean.
 *  The value is the vault entry's `importedAt` the grant was given for — a session grant is bound to that entry too. */
const sessionGrants = new Map<string, number>();
export function clearSessionGrants(): void { sessionGrants.clear(); }

// ── the release ─────────────────────────────────────────────────────────────
/** The approval question, exactly as the permission system shows it. */
const releasePrompt = (site: string): string => `Use your saved ${site} session for this task? (once / this session / always for this site / no)`;
const ANSWERS: readonly ReleaseAnswer[] = Object.freeze(['once', 'session', 'always', 'no']);
const RANK: Record<ReleaseMode, number> = { once: 1, session: 2, always: 3 };

/** The cookie fields CDP takes, 1:1 with the vault's shape. Anything undefined is left out, never sent as null. */
const COOKIE_FIELDS = ['name', 'value', 'domain', 'path', 'expires', 'secure', 'httpOnly', 'sameSite', 'partitionKey'] as const;

/** Map one stored cookie to a CDP CookieParam: same names, same values, no renaming, no defaults invented. */
function toCdpCookie(c: VaultCookie): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of COOKIE_FIELDS) {
    const v = c[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** A cookie is expired when it carries a real expiry (a number > 0, epoch SECONDS) that is already in the past. A session
 *  cookie (no `expires`) and an `expires` of 0 or less are kept: they are not "expired", they simply never expire. */
function isExpired(c: VaultCookie, nowMs: number): boolean {
  return typeof c.expires === 'number' && c.expires > 0 && c.expires * 1000 < nowMs;
}

/**
 * Release a site's saved session into `cdp`.
 *
 * `mode` is what the CALLER asks for; the user's answer can only narrow it (an answer of 'always' for a 'once' request is
 * honoured as 'once' — a caller never gets a standing grant it did not ask for). An unrecognised answer fails closed.
 *
 * Returns `{ site, loaded }` — how many cookies were actually loaded — and never a value.
 */
export async function releaseSite(site: string, mode: ReleaseMode, cdp: CdpLike, options: ReleaseOptions): Promise<ReleaseResult> {
  const requested = assertMode(mode);
  const s = assertSite(site);
  if (!cdp || typeof cdp.send !== 'function') throw new Error('a CDP session is required to release a saved session');

  const vaultFile = options.vaultFile ?? sessionVaultPath();
  const logFile = options.logFile ?? releaseLogPath();
  const grantsFile = options.grantsFile ?? grantsPath();
  const now = options.now ?? (() => Date.now());

  // 1. Is the site still in the vault? Checked FIRST and again before any grant is honoured: a grant left behind by a revoke
  //    can never release anything, and nothing is asked for a site we cannot release anyway. The entry's importedAt is the
  //    identity a grant is bound to: a re-imported site is a DIFFERENT entry, so an old grant must not carry over.
  const summary = listSites(vaultFile).find((x) => x.site === s);
  if (!summary) return { site: s, loaded: 0 };
  const importedAt = summary.importedAt;

  // 2. Which mode applies? A standing grant for THIS entry (memory, then disk) skips the question; otherwise ask. A grant
  //    without an importedAt (an older file) or with a different one is stale: it is not honoured, and a new answer overwrites it.
  let effective: ReleaseMode | undefined;
  if (sessionGrants.get(s) === importedAt) effective = 'session';
  if (!effective) {
    const stored = readGrantRecord(s, grantsFile);
    if (stored?.mode !== undefined && stored.importedAt === importedAt) effective = stored.mode;
  }
  if (!effective) {
    const answer = await options.ask(releasePrompt(s), ANSWERS);
    if (answer !== 'once' && answer !== 'session' && answer !== 'always') return { site: s, loaded: 0 };  // 'no' / unknown: nothing released
    effective = RANK[answer] <= RANK[requested] ? answer : requested;
    if (effective === 'always') setGrant(s, now(), importedAt, grantsFile);
    else if (effective === 'session') sessionGrants.set(s, importedAt);
  }

  // 3. The values come out of the vault here. Expired cookies are dropped before they reach the browser: a release of a
  //    session that has already timed out would load nothing useful and would only look like a success.
  const entry = getSiteForRelease(s, vaultFile, options.env ?? process.env);
  const at = now();
  const cookies = entry.cookies.filter((c) => !isExpired(c, at)).map(toCdpCookie);
  if (!cookies.length) return { site: s, loaded: 0 };

  // 4. Audit the attempt BEFORE the browser is told: if the log cannot be written, nothing is sent (fail closed) and the
  //    attempt is on record only when the log actually accepted it. site + mode + time (+ an optional task id the store
  //    sanitises) — never a value.
  appendReleaseLog({ site: s, mode: effective, at, ...(options.task !== undefined ? { task: options.task } : {}) }, logFile);

  try {
    await cdp.send('Network.setCookies', { cookies });
  } catch {
    // The driver's own message is DROPPED on purpose: it can quote the cookie it rejected.
    throw new Error(`could not release the saved session for ${s} (the browser rejected Network.setCookies)`);
  }

  return { site: s, loaded: cookies.length };
}

/**
 * Revoke a site completely: the vault entry AND any standing grant, so a later release has nothing to honour and nothing to
 * load. Revoking never needs the vault key (the store's revokeSite works locked).
 */
export async function revokeSessionSite(site: string, options: RevokeOptions = {}): Promise<RevokeResult> {
  const s = assertSite(site);
  const revoked = revokeSite(s, options.vaultFile ?? sessionVaultPath());
  const grantCleared = clearGrant(s, options.grantsFile ?? grantsPath());
  sessionGrants.delete(s);
  return { site: s, revoked, grantCleared };
}
