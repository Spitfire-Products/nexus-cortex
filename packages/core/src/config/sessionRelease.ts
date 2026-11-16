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
  listSites, getSiteForRelease, revokeSite, appendReleaseLog, refreshSite,
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

/** What a release returns. Never a cookie, never a storage value — only how many cookies were loaded. `expired` (every cookie for
 *  the site was already past its expiry, so nothing was asked and nothing was sent) and `skipped` (cookies dropped because their
 *  partitionKey could not be expressed as a CDP partition key) appear only when non-zero. */
export interface ReleaseResult { site: string; loaded: number; expired?: number; skipped?: number; warning?: string }

// ── early warning (operator 11-16) ──────────────────────────────────────────
/** A saved sign-in whose latest real cookie expiry is within this many days is "expiring soon" (list, /signins, release results). */
export const SESSION_EXPIRY_WARN_DAYS = 14;
export const SESSION_WARNINGS_FILE = 'session-vault-warnings.jsonl';
/** `~/.cortex/session-vault-warnings.jsonl` — site, kind, expiresAt, time; never a value. A watcher (or a person) reads it. */
export const sessionWarningsPath = (): string => path.join(getGlobalConfigDir(), SESSION_WARNINGS_FILE);
export type ExpiryState = 'ok' | 'expiring' | 'expired' | 'unknown';
/** Expiry state of a site from its listed expiresAt (epoch s; the LATEST real cookie expiry). No expiresAt = session cookies only. */
export function expiryState(expiresAt: number | undefined, nowMs = Date.now(), warnDays = SESSION_EXPIRY_WARN_DAYS): ExpiryState {
  if (typeof expiresAt !== 'number' || expiresAt <= 0) return 'unknown';
  if (expiresAt * 1000 < nowMs) return 'expired';   // same rule as isExpired: a cookie expiring exactly now still loads
  return expiresAt * 1000 - nowMs <= warnDays * 86_400_000 ? 'expiring' : 'ok';
}
const warnLine = (site: string, st: ExpiryState, expiresAt?: number): string =>
  st === 'expired' ? `the saved sign-in for ${site} has expired — re-import it (cortex browser-secrets import ${site}) and grant it again for scheduled tasks`
  : `the saved sign-in for ${site} expires ${new Date((expiresAt ?? 0) * 1000).toISOString().slice(0, 10)} — re-import it soon (cortex browser-secrets import ${site}); a re-import needs a fresh grant for scheduled tasks`;
/** Append one warning (site, kind, expiresAt, time — never a value), at most once per site and kind per day. Best effort: never throws. */
export function noteSessionWarning(site: string, kind: 'expiring' | 'expired', expiresAt: number | undefined, nowMs = Date.now(), file = sessionWarningsPath()): void {
  try {
    const day = new Date(nowMs).toISOString().slice(0, 10);
    if (fs.existsSync(file)) {
      const seen = fs.readFileSync(file, 'utf8').split('\n').some((l) => { try { const r = JSON.parse(l); return r.site === site && r.kind === kind && String(r.at).slice(0, 10) === day; } catch { return false; } });
      if (seen) return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, JSON.stringify({ site, kind, ...(expiresAt ? { expiresAt } : {}), at: new Date(nowMs).toISOString() }) + '\n', { mode: 0o600 });
  } catch { /* a warning must never block a release */ }
}

// ── write-back bookkeeping (operator 11-16) ─────────────────────────────────
/** Sites THIS process released, with the import they came from. Only these are ever written back (refreshSite checks the lineage). */
const releasedHere = new Map<string, number>();
/** The cookie NAMES each released site was loaded with (non-expired) — the write-back's signed-out guard. Names only, never values. */
const loadedNames = new Map<string, string[]>();
/** Test seam: forget what this process released. */
export function _resetReleasedForTests(): void { releasedHere.clear(); loadedNames.clear(); }
export function releasedSites(): Array<{ site: string; importedAt: number }> { return [...releasedHere].map(([site, importedAt]) => ({ site, importedAt })); }


/** CDP's CHIPS partition key, exactly as `Network.setCookies` takes it. */
export interface CdpPartitionKey { topLevelSite: string; hasCrossSiteAncestor: boolean }

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
  /**
   * The permission context's `sessionId`, passed through `runLoadSession`'s opts by the browser tool glue. A pre-approval is
   * bound to the session that answered the dialog, so WITHOUT this the take matches nothing and the tool's own `ask` is used
   * (fail closed: never a silent release, only an extra question). A headless / auto-approve run therefore never inherits an
   * interactive answer it did not get.
   */
  sessionId?: string;
  /**
   * The user's answer carried in from ANOTHER process by a release ticket (sessionTicket.ts): the browser process consumes the
   * ticket the harness minted and passes its scope here. Honoured only for the SAME vault entry (importedAt); like the in-process
   * pre-approval it is the user's own choice, so it is not capped by the caller's `mode`.
   */
  ticket?: { scope: PreApprovalScope; importedAt: number };
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

/** The standing grant record for a site (mode + time + the vault entry it was given for), for the permissions floor. Metadata
 *  only: a mode and two timestamps, never a cookie or a storage value. */
export function readGrantForSite(site: string, file = grantsPath()): Partial<SiteGrant> | undefined {
  return readGrantRecord(site, file);
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
 *  A grant is bound to site + the vault entry's `importedAt` + the SESSION that answered the dialog: one cortex-server process runs
 *  several sessions, and session A's "this session" must never release in session B. With no sessionId nothing is remembered. */
const sessionGrants = new Set<string>();
const sessionGrantKey = (site: string, importedAt: number, sessionId: string): string => `${site}\u0000${String(importedAt)}\u0000${sessionId}`;
export function clearSessionGrants(): void { sessionGrants.clear(); }
/** Drop every 'session' grant for a site (a revoke), or only those not bound to `keepImportedAt` (a re-import made them stale). */
function dropSessionGrants(site: string, keepImportedAt?: number): void {
  for (const k of [...sessionGrants]) {
    const [s, imp] = k.split('\u0000');
    if (s === site && (keepImportedAt === undefined || imp !== String(keepImportedAt))) sessionGrants.delete(k);
  }
}
/** T4 (the /sessions menu): record a 'this session' grant for one vault entry + one session, exactly as a dialog answer does. In memory
 *  only; nothing is recorded without a sessionId (fail closed). */
export function addSessionGrant(site: string, importedAt: number, sessionId: string | undefined): boolean {
  const s = assertSite(site);
  if (typeof sessionId !== 'string' || !sessionId.trim() || !Number.isFinite(importedAt)) return false;
  dropSessionGrants(s, importedAt);
  sessionGrants.add(sessionGrantKey(s, importedAt, sessionId.trim()));
  return true;
}
/** T4: forget every 'this session' grant for a site (the menu's "clear grant"). */
export function clearSessionGrantsForSite(site: string): void { dropSessionGrants(assertSite(site)); }
/** Is there a 'session' grant, in this process, for exactly this vault entry AND this session? The floor policy uses it so a 'this session' answer really skips the next dialog — for the session that gave it only. */
export function hasSessionGrant(site: string, importedAt: number, sessionId?: string): boolean {
  return typeof sessionId === 'string' && sessionId !== '' && sessionGrants.has(sessionGrantKey(site, importedAt, sessionId));
}

// ── the one-shot pre-approval handoff (T3, D2: ONE question per release) ────
/**
 * The interactive flow asks the question in the PERMISSION dialog (the floor's four-way ask), then the tool calls releaseSite.
 * Without a handoff the user would be asked twice. The floor records its answer here — in memory, keyed by site, consumed by
 * the very next releaseSite for that site, and forgotten after 30 s — so releaseSite can skip its own question.
 *
 * What this is NOT: a grant. It is never written to disk, it is not consulted by the floor, and it does not survive the process.
 * 'always' still becomes a standing grant the ordinary way (releaseSite's setGrant), 'session' still only in sessionGrants.
 */
export const PRE_APPROVAL_TTL_MS = 30_000;
/** Scope the floor can hand over. 'no' is never recorded — a refusal releases nothing, so there is nothing to hand over. */
export type PreApprovalScope = Exclude<ReleaseAnswer, 'no'>;

/**
 * The identity a pre-approval is BOUND to. Not the site alone: a site is re-imported as a different vault entry
 * (`importedAt` changes) and two sessions in one process must never answer for each other, so the binding is
 * site + the entry's `importedAt` + the permission context's `sessionId`.
 *
 * `sessionId` is REQUIRED on both sides to be usable: a note or a take without one matches nothing (fail closed — the
 * release falls back to the tool's own `ask`). A take whose site / importedAt / sessionId differs from the stored
 * entry returns undefined and LEAVES the stored entry in place, so a mismatched call can never burn the user's answer.
 */
export interface PreApprovalRef {
  site: string;
  importedAt: number;
  sessionId?: string | undefined;
}
/** What the floor records: the user's answer, bound to the entry and the session that answered for it. */
export interface NotePreApprovalArgs extends PreApprovalRef { scope: PreApprovalScope; now?: number }
/** What releaseSite asks for: the same binding, with no scope (only the stored one can be handed back). */
export interface TakePreApprovalArgs extends PreApprovalRef { now?: number }

/** site + importedAt + sessionId, NUL-separated so no site or id can impersonate another key by concatenation. */
const preApprovalKey = (site: string, importedAt: number, sessionId: string): string =>
  `${site}\u0000${String(importedAt)}\u0000${sessionId}`;

const preApprovals = new Map<string, { scope: PreApprovalScope; at: number }>();

/** Drop entries past the TTL. A mismatched take leaves a live entry alone; only expiry ever removes one. */
function sweepExpired(nowMs: number): void {
  for (const [k, v] of preApprovals) if (nowMs - v.at > PRE_APPROVAL_TTL_MS) preApprovals.delete(k);
}

/**
 * Record the user's answer from the permission dialog. In memory only; never disk. A note with no `sessionId`, no site or
 * an invalid scope records nothing — it could never be consumed, and a dead entry is a leak, not a handoff.
 */
export function notePreApproval(args: NotePreApprovalArgs): void {
  const s = String(args?.site ?? '').trim().toLowerCase();
  const sid = typeof args?.sessionId === 'string' ? args.sessionId.trim() : '';
  const scope = args?.scope;
  const nowMs = args?.now ?? Date.now();
  if (!s || !sid) return;
  if (scope !== 'once' && scope !== 'session' && scope !== 'always') return;
  if (typeof args?.importedAt !== 'number' || !Number.isFinite(args.importedAt)) return;
  sweepExpired(nowMs);
  preApprovals.set(preApprovalKey(s, args.importedAt, sid), { scope, at: nowMs });
}

/**
 * Consume the pre-approval bound to exactly this site + vault entry + session. ONE-SHOT: the second call returns undefined.
 * A mismatch (site, importedAt or sessionId) or a missing sessionId returns undefined and does NOT touch the stored entry.
 */
export function takePreApproval(args: TakePreApprovalArgs): PreApprovalScope | undefined {
  const s = String(args?.site ?? '').trim().toLowerCase();
  const sid = typeof args?.sessionId === 'string' ? args.sessionId.trim() : '';
  const nowMs = args?.now ?? Date.now();
  sweepExpired(nowMs);
  if (!s || !sid) return undefined;
  if (typeof args?.importedAt !== 'number' || !Number.isFinite(args.importedAt)) return undefined;
  const key = preApprovalKey(s, args.importedAt, sid);
  const hit = preApprovals.get(key);
  if (!hit) return undefined;
  preApprovals.delete(key);
  if (nowMs - hit.at > PRE_APPROVAL_TTL_MS) return undefined;
  return hit.scope;
}

/** Drop every pending pre-approval (a fresh process, or a test starting clean). */
export function clearPreApprovals(): void { preApprovals.clear(); }

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

/** One cookie ready for `Network.setCookies`. `null` means the stored partitionKey cannot be expressed as a CDP partition key:
 *  the cookie is dropped (and counted in `skipped`) rather than sent unpartitioned. */
function toCdpCookieForSend(c: VaultCookie): Record<string, unknown> | null {
  const pk = toCdpPartitionKey(c.partitionKey);
  if (pk === null) return null;
  const out = toCdpCookie(c);
  if (pk === undefined) delete out.partitionKey;
  else out.partitionKey = pk;
  return out;
}

/** A cookie is expired when it carries a real expiry (a number > 0, epoch SECONDS) that is already in the past. A session
 *  cookie (no `expires`) and an `expires` of 0 or less are kept: they are not "expired", they simply never expire. */
function isExpired(c: VaultCookie, nowMs: number): boolean {
  return typeof c.expires === 'number' && c.expires > 0 && c.expires * 1000 < nowMs;
}

/**
 * Convert a stored `partitionKey` to what CDP `Network.setCookies` wants.
 *
 * CDP `Network.setCookies` takes `{ topLevelSite, hasCrossSiteAncestor }`. Chrome's cookie DB stores that key as two columns —
 * `top_frame_site_key` and `has_cross_site_ancestor` — and BOTH are part of the partition a cookie is written into, so the flag
 * must travel with the cookie: a cookie restored with the wrong `hasCrossSiteAncestor` lands in a DIFFERENT partition (it is
 * unreachable, not leaked, but the session the user asked for is silently missing).
 *
 * Two stored shapes are accepted:
 *   - the OBJECT form `{ topLevelSite, hasCrossSiteAncestor }` — what a browser importer must store, read from Chrome's
 *     `has_cross_site_ancestor` column. Its flag is kept EXACTLY as stored, never forced to false.
 *   - a bare STRING — the LEGACY / unknown form (the T1 importer kept `top_frame_site_key` alone, so the flag was never
 *     recorded). It stays `{ topLevelSite: string, hasCrossSiteAncestor: false }`: 'false' is the only defensible reading of an
 *     unknown flag, and inventing 'true' would move the cookie into a partition the browser never wrote it to.
 *
 * The three outcomes are distinct and the caller MUST tell them apart:
 *   - `undefined` → the cookie is unpartitioned; send it with no partitionKey at all (never null, never an empty object).
 *   - a `CdpPartitionKey` → send it as the cookie's partitionKey.
 *   - `null` → the value cannot be expressed as a partition key (empty string, a number, an object without a string
 *     `topLevelSite`, or an object whose `hasCrossSiteAncestor` is not a boolean). The cookie is DROPPED and counted in `skipped`: sending it unpartitioned would leak a partitioned cookie
 *     across top-level sites, which is exactly what partitioning exists to prevent.
 */
export function toCdpPartitionKey(v: unknown): CdpPartitionKey | undefined | null {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v.trim() ? { topLevelSite: v.trim(), hasCrossSiteAncestor: false } : null;
  if (typeof v === 'object') {
    const o = v as { topLevelSite?: unknown; hasCrossSiteAncestor?: unknown };
    if (typeof o.topLevelSite !== 'string' || !o.topLevelSite.trim()) return null;
    // The flag is part of the key: keep it as stored, and refuse to guess when it is absent or not a boolean.
    if (typeof o.hasCrossSiteAncestor !== 'boolean') return null;
    return { topLevelSite: o.topLevelSite.trim(), hasCrossSiteAncestor: o.hasCrossSiteAncestor };
  }
  return null;
}

/**
 * Release a site's saved session into `cdp`.
 *
 * `mode` is what the CALLER asks for; the user's answer can only narrow it (an answer of 'always' for a 'once' request is
 * honoured as 'once' — a caller never gets a standing grant it did not ask for). An unrecognised answer fails closed.
 *
 * Returns `{ site, loaded }` — how many cookies were actually loaded — and never a value.
 */
export async function releaseSite(site: string, mode: ReleaseMode, cdp: CdpLike, options: ReleaseOptions): Promise<ReleaseResult> {  const requested = assertMode(mode);
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

  // 2. The values come out of the vault here — BEFORE any question is asked, so that a session which has already timed out is
  //    never worth a prompt (T2 review, carried): decrypt first, then drop the expired cookies with the same isExpired rule.
  const entry = getSiteForRelease(s, vaultFile, options.env ?? process.env);
  const at = now();
  const live = entry.cookies.filter((c) => !isExpired(c, at));
  if (entry.cookies.length > 0 && live.length === 0) {
    // EVERY cookie for the site is expired: nothing is asked, nothing is logged, nothing is sent. `loaded: 0` says it plainly.
    noteSessionWarning(s, 'expired', summary.expiresAt, at, path.join(path.dirname(logFile), SESSION_WARNINGS_FILE));
    return { site: s, loaded: 0, expired: entry.cookies.length, warning: warnLine(s, 'expired', summary.expiresAt) };
  }

  // 3. Which mode applies? A standing grant for THIS entry (memory, then disk) skips the question; otherwise ask. A grant
  //    without an importedAt (an older file) or with a different one is STALE: it is cleared the moment it is found — before
  //    asking — so the stale grant is gone on ANY answer, not only on a yes (T2 review, carried).
  let effective: ReleaseMode | undefined;
  if (hasSessionGrant(s, importedAt, options.sessionId)) effective = 'session';
  if (!effective) {
    const stored = readGrantRecord(s, grantsFile);
    if (stored?.mode !== undefined && stored.importedAt === importedAt) effective = stored.mode;
    else if (stored) { clearGrant(s, grantsFile); }
  }
  dropSessionGrants(s, importedAt);   // a re-import makes every older session grant stale
  if (!effective) {
    // D2: the permission dialog already asked this question for this call — consume its answer instead of asking again. The
    // pre-approval is the USER's own choice in the harness dialog, so it is NOT capped by the caller's `mode` argument (that is model-chosen: it must not be able to downgrade what the user picked). Only an answer from the tool's own `ask` callback is narrowed by `requested`.
    const fromTicket = options.ticket && options.ticket.importedAt === importedAt ? options.ticket.scope : undefined;
    const preApproved = fromTicket ?? takePreApproval({ site: s, importedAt, ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}), now: now() });
    const answer: ReleaseAnswer = preApproved ?? await options.ask(releasePrompt(s), ANSWERS);
    if (answer !== 'once' && answer !== 'session' && answer !== 'always') return { site: s, loaded: 0 };  // 'no' / unknown: nothing released
    effective = preApproved !== undefined ? answer : RANK[answer] <= RANK[requested] ? answer : requested;
    if (effective === 'always') setGrant(s, now(), importedAt, grantsFile);
    else if (effective === 'session' && options.sessionId) sessionGrants.add(sessionGrantKey(s, importedAt, options.sessionId));
  }

  // 4. Map to CDP params. A cookie whose partitionKey cannot be expressed is DROPPED and counted in `skipped` — never sent
  //    unpartitioned, which would defeat the partitioning the browser applied when the cookie was written.
  let skipped = 0;
  const cookies: Record<string, unknown>[] = [];
  for (const c of live) {
    const mapped = toCdpCookieForSend(c);
    if (mapped) cookies.push(mapped); else skipped += 1;
  }
  if (!cookies.length) return { site: s, loaded: 0, ...(skipped > 0 ? { skipped } : {}) };

  // 5. Audit the attempt BEFORE the browser is told: if the log cannot be written, nothing is sent (fail closed) and the
  //    attempt is on record only when the log actually accepted it. site + mode + time (+ an optional task id the store
  //    sanitises) — never a value.
  appendReleaseLog({ site: s, mode: effective, at, ...(options.task !== undefined ? { task: options.task } : {}) }, logFile);

  try {
    await cdp.send('Network.setCookies', { cookies });
  } catch {
    // The driver's own message is DROPPED on purpose: it can quote the cookie it rejected.
    throw new Error(`could not release the saved session for ${s} (the browser rejected Network.setCookies)`);
  }

  releasedHere.set(s, importedAt);   // eligible for write-back (writeBackLoadedSessions), bound to THIS import
  loadedNames.set(s, [...new Set(live.map((c) => c.name))]);
  const st = expiryState(summary.expiresAt, at);
  if (st === 'expiring' || st === 'expired') noteSessionWarning(s, st, summary.expiresAt, at, path.join(path.dirname(logFile), SESSION_WARNINGS_FILE));   // beside the release log (tests with a temp log stay in their temp dir)
  return { site: s, loaded: cookies.length, ...(skipped > 0 ? { skipped } : {}), ...(st === 'expiring' || st === 'expired' ? { warning: warnLine(s, st, summary.expiresAt) } : {}) };
}

/** One CDP cookie (Network.getAllCookies) → the vault's cookie shape. Session cookies (session: true / expires <= 0) carry no expires. */
function fromCdpCookie(c: any): VaultCookie | null {
  if (!c || typeof c.name !== 'string' || !c.name || typeof c.value !== 'string' || typeof c.domain !== 'string') return null;
  const out: VaultCookie = { name: c.name, value: c.value, domain: c.domain, path: typeof c.path === 'string' ? c.path : '/', secure: !!c.secure, httpOnly: !!c.httpOnly };
  if (c.sameSite === 'Strict' || c.sameSite === 'Lax' || c.sameSite === 'None') out.sameSite = c.sameSite;
  if (!c.session && typeof c.expires === 'number' && c.expires > 0) out.expires = Math.floor(c.expires);
  if (c.partitionKey && typeof c.partitionKey === 'object' && typeof c.partitionKey.topLevelSite === 'string' && typeof c.partitionKey.hasCrossSiteAncestor === 'boolean') {
    (out as any).partitionKey = { topLevelSite: c.partitionKey.topLevelSite, hasCrossSiteAncestor: c.partitionKey.hasCrossSiteAncestor };
  }
  return out;
}

/**
 * WRITE-BACK (operator 11-16): store the browser's current cookies for every site THIS process released, so a saved sign-in stays as
 * fresh as the agent's own browsing (X, GitHub … rotate tokens as you browse). The browser glue calls this on a timer and at shutdown.
 * Per site: keep only that site's cookie domains, KEEP the import lineage (grants stay valid), skip a site re-imported meanwhile or with
 * no cookies in the browser. Logged as mode 'refresh' with counts only; never throws for one site.
 */
export async function writeBackLoadedSessions(cdp: CdpLike, opts: { vaultFile?: string; logFile?: string; env?: NodeJS.ProcessEnv; now?: () => number } = {}):
  Promise<Array<{ site: string; saved?: number; skipped?: string }>> {
  if (!releasedHere.size || !cdp || typeof cdp.send !== 'function') return [];
  let all: any[] = [];
  try { all = ((await cdp.send('Network.getAllCookies')) as { cookies?: any[] })?.cookies ?? []; }
  catch { return [...releasedHere.keys()].map((site) => ({ site, skipped: 'the browser did not return its cookies' })); }
  const now = (opts.now ?? Date.now)();
  const out: Array<{ site: string; saved?: number; skipped?: string }> = [];
  for (const [site, importedAt] of releasedHere) {
    try {
      const cookies = all.map(fromCdpCookie).filter((c): c is VaultCookie => c !== null);
      // SIGNED-OUT GUARD (11-16, real-Mac test: X rejected the session in the agent's browser): if any cookie the site was loaded with is
      // gone from the browser, the site most likely signed the agent out (a logout deletes its session cookies). Writing that jar back
      // would destroy a good saved sign-in, so skip — the user's import stays as it was.
      const have = new Set(cookies.filter((c) => { const d = c.domain.replace(/^\./, '').toLowerCase(); return d === site || d.endsWith('.' + site); }).map((c) => c.name));
      const missing = (loadedNames.get(site) ?? []).filter((n) => !have.has(n));
      if (missing.length) {
        const reason = `signed-out? ${missing.length} loaded cookie(s) gone from the browser (${missing.slice(0, 5).join(', ')}) — saved sign-in kept`;
        // durable + greppable (11-16: the browser child's stderr reaches no log): beside the release log, names only, never a value
        try { fs.appendFileSync(path.join(path.dirname(opts.logFile ?? releaseLogPath()), SESSION_WARNINGS_FILE), JSON.stringify({ site, kind: 'refresh-skipped', reason, at: new Date(now).toISOString() }) + '\n', { mode: 0o600 }); } catch { /* best effort */ }
        out.push({ site, skipped: reason }); continue;
      }
      const r = refreshSite(site, cookies, { expectImportedAt: importedAt, now, ...(opts.vaultFile ? { file: opts.vaultFile } : {}), ...(opts.env ? { env: opts.env } : {}) });
      if ('saved' in r) {
        appendReleaseLog({ site, mode: 'refresh', at: now }, opts.logFile ?? releaseLogPath());
        out.push({ site, saved: r.saved });
      } else {
        if (r.skipped === 'reimported' || r.skipped === 'missing') releasedHere.delete(site);   // a newer import or a revoke: never write this one back
        out.push({ site, skipped: r.skipped });
      }
    } catch (e) { out.push({ site, skipped: String((e as Error)?.message || e).slice(0, 160) }); }
  }
  return out;
}

/**
 * Revoke a site completely: the vault entry AND any standing grant, so a later release has nothing to honour and nothing to
 * load. Revoking never needs the vault key (the store's revokeSite works locked).
 */
export async function revokeSessionSite(site: string, options: RevokeOptions = {}): Promise<RevokeResult> {
  const s = assertSite(site);
  const revoked = revokeSite(s, options.vaultFile ?? sessionVaultPath());
  const grantCleared = clearGrant(s, options.grantsFile ?? grantsPath());
  dropSessionGrants(s);
  return { site: s, revoked, grantCleared };
}
