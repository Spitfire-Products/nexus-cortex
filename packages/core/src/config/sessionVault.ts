/**
 * sessionVault — the encrypted, engine-neutral record of imported browser sessions (vault task T1).
 *
 * One file, `~/.cortex/session-vault.enc` (owner-only, written atomically): the cookies + web storage of every site that was
 * imported from a real browser, keyed by registrable domain. This module is ONLY the store — no cookie import, no browser
 * loader, no prompt UI.
 *
 * Encryption is the secrets vault's, unchanged (./secretsVault.ts): PBKDF2-SHA256 100k → AES-256-GCM, `{ iv, ciphertext, tag,
 * version }` in base64, and the SAME unlock order — CORTEX_SECRETS_KEY → CORTEX_SECRETS_KEY_FILE → OS keychain →
 * ~/.cortex/vault.key. No new crypto is introduced here. A `check` value written with the key detects a wrong master before any
 * record is touched, so a bad key fails loudly instead of returning garbage.
 *
 * What is plaintext in the file: the site, its source ('chrome:Default'), the timestamps and the cookie count — that is exactly
 * what listSites() reports and it never needs a key. Cookie values and storage values live only inside the encrypted payload and
 * are only ever returned by getSiteForRelease(), which is internal to the release path. Nothing here logs a value.
 *
 * Release audit: `~/.cortex/session-vault-release.jsonl` gets one line per release — site, mode, time, optional task. Never a value.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { deriveKey, encryptValue, decryptValue, resolveMasterSecret, type EncryptedSecret } from './secretsVault.js';

/** Same rule as SettingsLoader.getGlobalConfigDir (kept local, exactly as secretsVault.ts does, so this store pulls in no config
 *  graph of its own — CORTEX_HOME relocates the directory for every surface and for tests). */
const getGlobalConfigDir = (): string => path.join(process.env.CORTEX_HOME || os.homedir() || process.cwd(), '.cortex');

export const SESSION_VAULT_FILE = 'session-vault.enc';
export const SESSION_RELEASE_LOG_FILE = 'session-vault-release.jsonl';
/** The PBKDF2 derivation id for THIS store. The secrets vault uses deriveKey(master)'s default id, so the same master yields a
 *  DISTINCT key here: a key that opens secrets.enc cannot open session-vault.enc, and vice versa. */
export const SESSION_VAULT_KEY_ID = 'nexus-cortex-session-vault';
const CHECK_PLAINTEXT = 'nexus-cortex-session-vault-ok';

/** One cookie, in the engine-neutral shape every browser import is normalised to. */
export interface VaultCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** epoch SECONDS (the shape browsers report), not milliseconds */
  expires?: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  /** CHIPS / partitioned cookie key, when the browser had one */
  partitionKey?: string;
}

/** One site's imported session. `site` is the registrable domain ('github.com'); cookies may live on its subdomains. */
export interface SiteEntry {
  site: string;
  cookies: VaultCookie[];
  storage?: Record<string, string>;
  /** where it came from, e.g. 'chrome:Default' */
  source: string;
  importedAt: number;
  /** min cookie expiry (epoch s), when any cookie expires */
  expiresAt?: number;
}

/** What listSites() reports: enough to choose a site, never enough to use one. */
export interface SiteSummary { site: string; source: string; importedAt: number; expiresAt?: number; cookieCount: number }

export type ReleaseMode = 'once' | 'session' | 'always';
export interface ReleaseLogEntry { site: string; mode: ReleaseMode; at: number; task?: string }

/** Test seam: replace the temp-file write (a simulated disk failure must never damage the vault). */
export interface SessionVaultIO { writeTmp?: (tmpPath: string, data: string) => void }

interface StoredSite { site: string; source: string; importedAt: number; expiresAt?: number; cookieCount: number; payload: EncryptedSecret }
interface SessionVaultFile { version: 1; check: EncryptedSecret; sites: Record<string, StoredSite> }

/** `~/.cortex/session-vault.enc` (CORTEX_HOME relocates it, like every other cortex file). */
export const sessionVaultPath = (): string => path.join(getGlobalConfigDir(), SESSION_VAULT_FILE);
/** `~/.cortex/session-vault-release.jsonl` — the release audit trail. */
export const releaseLogPath = (): string => path.join(getGlobalConfigDir(), SESSION_RELEASE_LOG_FILE);

// ── validation ──────────────────────────────────────────────────────────────
/** A site is a bare registrable domain: no scheme, no path, no port, no whitespace, at least one dot. Refuse anything else rather
 *  than guess. Public-suffix checks (e.g. refusing 'co.uk') are deliberately OUT OF SCOPE here — a later task owns that. */
function assertSite(site: unknown): string {
  if (typeof site !== 'string' || !site.trim()) throw new Error('a site is required (the registrable domain, e.g. github.com)');
  const s = site.trim().toLowerCase();
  if (s.includes('/')) throw new Error(`invalid site "${site}": a site is a domain (e.g. github.com), not a URL or a path`);
  if (s.startsWith('.') || s.includes('..') || /\s/.test(s)) throw new Error(`invalid site "${site}": a site is a bare domain (e.g. github.com)`);
  if (!s.includes('.')) throw new Error(`invalid site "${site}": a site is a registrable domain with a dot (e.g. github.com), not a single label`);
  return s;
}

/** Browsers write a leading dot for a parent-domain cookie ('.github.com'); it means the same domain. */
const bareDomain = (d: string): string => d.trim().toLowerCase().replace(/^\./, '');

/** A cookie may be set on the site itself or on one of its subdomains — never on a sibling or a parent. */
const domainAllowed = (domain: string, site: string): boolean => { const d = bareDomain(domain); return d === site || d.endsWith(`.${site}`); };

function assertEntry(entry: SiteEntry): SiteEntry {
  if (!entry || typeof entry !== 'object') throw new Error('a site entry is required');
  const site = assertSite(entry.site);
  if (typeof entry.importedAt !== 'number' || !Number.isFinite(entry.importedAt)) throw new Error(`invalid site entry for ${site}: importedAt must be a finite epoch-ms number`);
  if (!Array.isArray(entry.cookies)) throw new Error(`invalid site entry for ${site}: cookies must be an array`);
  for (const c of entry.cookies) {
    if (!c || typeof c.name !== 'string' || !c.name) throw new Error(`invalid cookie for ${site}: a cookie needs a name`);
    if (typeof c.value !== 'string') throw new Error(`invalid cookie ${c.name} for ${site}: a cookie needs a value`);
    if (typeof c.domain !== 'string' || !bareDomain(c.domain)) throw new Error(`invalid cookie ${c.name} for ${site}: a cookie needs a domain`);
    if (!domainAllowed(c.domain, site)) throw new Error(`cookie domain "${c.domain}" does not belong to site "${site}" (a cookie must be on the site or one of its subdomains)`);
    if (c.sameSite !== undefined && c.sameSite !== 'Strict' && c.sameSite !== 'Lax' && c.sameSite !== 'None') throw new Error(`invalid cookie ${c.name} for ${site}: sameSite must be Strict, Lax or None`);
  }
  if (entry.storage !== undefined) {
    if (!entry.storage || typeof entry.storage !== 'object' || Array.isArray(entry.storage)) throw new Error(`invalid site entry for ${site}: storage must be a record of strings`);
    for (const [k, v] of Object.entries(entry.storage)) if (typeof v !== 'string') throw new Error(`invalid storage value for ${site}: ${k} must be a string`);
  }
  return { ...entry, site };
}

// ── the file ────────────────────────────────────────────────────────────────
function readSessionVault(file: string): SessionVaultFile | null {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as SessionVaultFile; }
  catch { throw new Error(`the session vault at ${file} is unreadable (not JSON) — refusing to touch it`); }
}

/** tmp + rename: a crash or a full disk never leaves a half-written vault. Owner-only (0600) in a 0700 directory. */
function writeSessionVault(data: SessionVaultFile, file: string, io: SessionVaultIO = {}): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    const json = JSON.stringify(data, null, 1);
    if (io.writeTmp) io.writeTmp(tmp, json); else fs.writeFileSync(tmp, json, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}

/** The key from the same non-interactive sources as the secrets vault; a stored vault must also pass its own check. */
function keyFor(data: SessionVaultFile | null, env: NodeJS.ProcessEnv): Buffer {
  const m = resolveMasterSecret(env);
  if (!m) throw new Error('session vault locked: set CORTEX_SECRETS_KEY (or CORTEX_SECRETS_KEY_FILE), or unlock with `cortex secrets unlock`');
  const key = deriveKey(m.master, SESSION_VAULT_KEY_ID);
  if (data) {
    let ok = false;
    try { ok = decryptValue(key, data.check) === CHECK_PLAINTEXT; } catch { ok = false; }
    if (!ok) throw new Error('wrong key for the session vault (the master secret does not match the one it was written with)');
  }
  return key;
}

// ── API ─────────────────────────────────────────────────────────────────────
/** Store (or replace) one site's session. Validates the site and every cookie domain before anything is written. */
export function putSite(entry: SiteEntry, file = sessionVaultPath(), env: NodeJS.ProcessEnv = process.env, io: SessionVaultIO = {}): SiteEntry {
  const e = assertEntry(entry);
  const data = readSessionVault(file);
  const key = keyFor(data, env);
  const vault: SessionVaultFile = data ?? { version: 1, check: encryptValue(key, CHECK_PLAINTEXT), sites: {} };
  const expiries = e.cookies.map((c) => c.expires).filter((x): x is number => typeof x === 'number');
  const expiresAt = e.expiresAt ?? (expiries.length ? Math.min(...expiries) : undefined);
  const payload = encryptValue(key, JSON.stringify({ cookies: e.cookies, storage: e.storage ?? {} }));
  vault.sites[e.site] = { site: e.site, source: e.source, importedAt: e.importedAt, ...(expiresAt !== undefined ? { expiresAt } : {}), cookieCount: e.cookies.length, payload };
  writeSessionVault(vault, file, io);
  return { ...e, ...(expiresAt !== undefined ? { expiresAt } : {}) };
}

/** What is stored, for choosing a site. Metadata only — never a cookie value, never a storage value. */
export function listSites(file = sessionVaultPath()): SiteSummary[] {
  const data = readSessionVault(file);
  if (!data) return [];
  return Object.values(data.sites ?? {})
    .map((s) => ({ site: s.site, source: s.source, importedAt: s.importedAt, ...(s.expiresAt !== undefined ? { expiresAt: s.expiresAt } : {}), cookieCount: s.cookieCount }))
    .sort((a, b) => a.site.localeCompare(b.site));
}

/** INTERNAL: the decrypted entry, for the release path only (this is the one function that returns values). */
export function getSiteForRelease(site: string, file = sessionVaultPath(), env: NodeJS.ProcessEnv = process.env): SiteEntry {
  const s = assertSite(site);
  const data = readSessionVault(file);
  const rec = data?.sites?.[s];           // one narrowed lookup: noUncheckedIndexedAccess makes a second read possibly-undefined
  if (!data || !rec) throw new Error(`no site ${s} in the session vault at ${file}`);
  const key = keyFor(data, env);
  let payload: { cookies?: VaultCookie[]; storage?: Record<string, string> };
  try { payload = JSON.parse(decryptValue(key, rec.payload)); }
  catch { throw new Error('wrong key for the session vault (the stored entry cannot be decrypted)'); }
  return {
    site: rec.site, cookies: payload.cookies ?? [], storage: payload.storage ?? {}, source: rec.source, importedAt: rec.importedAt,
    ...(rec.expiresAt !== undefined ? { expiresAt: rec.expiresAt } : {}),
  };
}

/** Drop a site's session. Works without the key on purpose: revoking access must never require an unlock. */
export function revokeSite(site: string, file = sessionVaultPath()): boolean {
  const s = assertSite(site);
  const data = readSessionVault(file);
  if (!data || !data.sites?.[s]) return false;
  delete data.sites[s];
  writeSessionVault(data, file);
  return true;
}

/** A task id the log will carry: short and boring, so a caller can never smuggle a value (a cookie, a token) into the audit trail.
 *  Anything else is silently DROPPED — the release is still logged, just without a task. */
const RELEASE_TASK_RE = /^[A-Za-z0-9._:-]{1,64}$/;

/** Append one release to the audit trail: site, mode, time and an optional task id — never a value. */
export function appendReleaseLog(entry: ReleaseLogEntry, file = releaseLogPath()): ReleaseLogEntry {
  const site = assertSite(entry?.site);
  const mode = entry?.mode;
  if (mode !== 'once' && mode !== 'session' && mode !== 'always') throw new Error(`invalid release mode "${String(mode)}": use once, session or always`);
  if (typeof entry.at !== 'number' || !Number.isFinite(entry.at)) throw new Error('a release log entry needs the time it happened (at, epoch ms)');
  const task = typeof entry.task === 'string' && RELEASE_TASK_RE.test(entry.task) ? entry.task : undefined;
  const line: ReleaseLogEntry = { site, mode, at: entry.at, ...(task !== undefined ? { task } : {}) };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, JSON.stringify(line) + '\n', { mode: 0o600 });
  return line;
}
