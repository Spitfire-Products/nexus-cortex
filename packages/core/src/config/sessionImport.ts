/**
 * sessionImport — import saved sign-ins from a Chrome-family browser into the session vault (vault task T1 importer).
 *
 * The person at the terminal picks a browser profile, sees the SITES it holds sessions for (names and counts only — listing needs no key
 * and decrypts nothing), and names the ones to import. Only those sites' cookies are decrypted, in memory, and written straight into
 * the encrypted vault with putSite(). Nothing here returns, logs or throws a cookie value.
 *
 * Browsers: Google Chrome, Brave, Microsoft Edge, Arc, Chromium — macOS and Linux. Windows (DPAPI + app-bound "v20" encryption) is
 * refused with the reason. Firefox / Safari importers are later tasks (design note "Own Browser Mode", session vault table).
 *
 * How Chrome stores a cookie (`<profile>/Cookies` or `<profile>/Network/Cookies`, SQLite):
 *   - `encrypted_value` = "v10" | "v11" + AES-128-CBC(key, iv = 16 × 0x20) of the value; `value` holds a plaintext value when unencrypted.
 *   - key = PBKDF2-SHA1(password, "saltysalt", iterations, 16 bytes):
 *       macOS — password = the "<Browser> Safe Storage" Keychain item (`security find-generic-password -w -s …`); 1003 iterations.
 *               macOS shows its own Allow dialog for that item: THAT dialog is the user's consent to the decrypt.
 *       Linux — v10: password "peanuts"; v11: the libsecret item (`secret-tool lookup application <app>`); 1 iteration.
 *   - DB meta `version` ≥ 24: the decrypted plaintext starts with SHA-256(host_key) (32 bytes) — verified (it proves the key), then stripped.
 *   - `expires_utc` = µs since 1601-01-01; `has_expires`/`is_persistent` = 0 → a session cookie (no `expires` written).
 *   - `samesite` −1 unspecified (omitted) · 0 None · 1 Lax · 2 Strict.
 *   - CHIPS: `top_frame_site_key` + `has_cross_site_ancestor` → partitionKey { topLevelSite, hasCrossSiteAncestor } (the OBJECT form the
 *     store contract requires). A partitioned cookie from a DB that has no `has_cross_site_ancestor` column is SKIPPED, not guessed.
 *
 * The DB is copied (with its -wal / -journal) to an owner-only temp dir first — the browser keeps it locked while running — and the copy
 * is removed before returning, whatever happens.
 *
 * Sensitive sites (banking, payments, email/identity, government, health, password managers) are listed with `sensitive: true` and are
 * imported only with `allowSensitive` — the CLI's explicit `--sensitive` acknowledgement. There is no import-everything call.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { putSite, sessionVaultPath, siteExpiresAt, type SiteEntry, type VaultCookie } from './sessionVault.js';
import { PUBLIC_SUFFIXES } from './sessionRelease.js';

export type ChromeBrowserId = 'chrome' | 'brave' | 'edge' | 'arc' | 'chromium';

interface BrowserSpec { id: ChromeBrowserId; label: string; mac: string; linux?: string; keychain: string; libsecretApp: string }
const BROWSERS: readonly BrowserSpec[] = [
  { id: 'chrome', label: 'Google Chrome', mac: 'Google/Chrome', linux: 'google-chrome', keychain: 'Chrome Safe Storage', libsecretApp: 'chrome' },
  { id: 'brave', label: 'Brave', mac: 'BraveSoftware/Brave-Browser', linux: 'BraveSoftware/Brave-Browser', keychain: 'Brave Safe Storage', libsecretApp: 'brave' },
  { id: 'edge', label: 'Microsoft Edge', mac: 'Microsoft Edge', linux: 'microsoft-edge', keychain: 'Microsoft Edge Safe Storage', libsecretApp: 'microsoft-edge' },
  { id: 'arc', label: 'Arc', mac: 'Arc/User Data', keychain: 'Arc Safe Storage', libsecretApp: 'arc' },
  { id: 'chromium', label: 'Chromium', mac: 'Chromium', linux: 'chromium', keychain: 'Chromium Safe Storage', libsecretApp: 'chromium' },
];

export interface ChromeProfile {
  browser: ChromeBrowserId;
  /** e.g. 'Google Chrome' */
  browserLabel: string;
  /** the profile DIRECTORY name ('Default', 'Profile 1') */
  profile: string;
  /** the name the browser shows for it (Local State), else the directory name */
  name: string;
  cookiesPath: string;
  /** what the vault records as the entry's source, e.g. 'chrome:Default' */
  source: string;
}

export interface ImportableSite { site: string; cookies: number; sensitive: boolean }
export interface ImportedSite { site: string; cookies: number; skipped: number }
export interface ImportResult { profile: string; imported: ImportedSite[]; refused: Array<{ site: string; reason: string }> }

export interface ImportOptions {
  /** platform override (tests) */
  platform?: NodeJS.Platform;
  /** The browser's Safe Storage password for this platform/version: (browser, version) → password | null. Default: Keychain / libsecret. */
  getPassword?: (browser: ChromeBrowserId, version: 'v10' | 'v11') => string | null;
  /** Import sensitive sites too (the CLI's explicit --sensitive). Default false: they are refused with the reason. */
  allowSensitive?: boolean;
  vaultFile?: string;
  env?: NodeJS.ProcessEnv;
  now?: number;
}

// ── sensitive sites ─────────────────────────────────────────────────────────
/** Suffix-matched at a dot boundary. Starts unticked in a picker, refused without --sensitive (design note, safety model point 3). */
export const SENSITIVE_SITE_PATTERNS: readonly string[] = Object.freeze([
  // government / military / tax
  '.gov', '.mil', '.gov.uk', '.gc.ca', '.gov.au', '.gouv.fr', '.bund.de', '.gov.in', 'irs.gov', 'ssa.gov', 'login.gov', 'id.me',
  // banking / payments / brokerage / credit
  '.bank', 'bankofamerica.com', 'chase.com', 'wellsfargo.com', 'citi.com', 'citibank.com', 'capitalone.com', 'usbank.com', 'pnc.com',
  'truist.com', 'tdbank.com', 'td.com', 'rbc.com', 'scotiabank.com', 'bmo.com', 'cibc.com', 'hsbc.com', 'hsbc.co.uk', 'barclays.co.uk',
  'lloydsbank.com', 'natwest.com', 'santander.com', 'santander.co.uk', 'bnpparibas.com', 'deutsche-bank.de', 'ally.com', 'sofi.com',
  'paypal.com', 'venmo.com', 'cash.app', 'zellepay.com', 'wise.com', 'revolut.com', 'stripe.com', 'coinbase.com', 'kraken.com', 'binance.com',
  'schwab.com', 'fidelity.com', 'vanguard.com', 'etrade.com', 'robinhood.com', 'interactivebrokers.com', 'americanexpress.com',
  'discover.com', 'visa.com', 'mastercard.com', 'experian.com', 'equifax.com', 'transunion.com', 'creditkarma.com',
  // email / identity providers / password managers
  'google.com', 'gmail.com', 'live.com', 'outlook.com', 'microsoft.com', 'microsoftonline.com', 'office.com', 'yahoo.com', 'aol.com',
  'icloud.com', 'apple.com', 'proton.me', 'protonmail.com', 'fastmail.com', 'zoho.com', 'okta.com', 'auth0.com', 'onelogin.com',
  'duosecurity.com', '1password.com', 'lastpass.com', 'bitwarden.com', 'dashlane.com', 'keepersecurity.com',
  // health
  'mychart.com', 'epic.com', 'kaiserpermanente.org', 'healthcare.gov', 'anthem.com', 'aetna.com', 'cigna.com', 'uhc.com', 'bcbs.com',
]);

export function isSensitiveSite(site: string): boolean {
  const s = site.trim().toLowerCase().replace(/^\.+/, '');
  return SENSITIVE_SITE_PATTERNS.some((p) => (p.startsWith('.') ? s.endsWith(p) || s === p.slice(1) : s === p || s.endsWith(`.${p}`)));
}

// ── registrable domain ──────────────────────────────────────────────────────
/** The registrable domain of a cookie host ('.www.github.com' → 'github.com', 'a.b.co.uk' → 'b.co.uk'); null for an IP / single label. */
export function registrableDomain(host: string): string | null {
  const h = host.trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
  if (!h || !h.includes('.') || /^\d+(\.\d+){3}$/.test(h) || h.includes(':')) return null;
  const labels = h.split('.');
  if (labels.length < 2) return null;
  const last2 = labels.slice(-2).join('.');
  if (PUBLIC_SUFFIXES.includes(last2)) return labels.length >= 3 ? labels.slice(-3).join('.') : null;
  return last2;
}

// ── profiles ────────────────────────────────────────────────────────────────
function browserRoot(spec: BrowserSpec, platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string | null {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', spec.mac);
  if (platform === 'linux') return spec.linux ? path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), spec.linux) : null;
  return null;
}

/** Every Chrome-family profile on this machine that has a cookie database. */
export function findChromeProfiles(o: { platform?: NodeJS.Platform; home?: string; env?: NodeJS.ProcessEnv } = {}): ChromeProfile[] {
  const platform = o.platform ?? process.platform;
  const home = o.home ?? os.homedir();
  const out: ChromeProfile[] = [];
  for (const spec of BROWSERS) {
    const root = browserRoot(spec, platform, home, o.env ?? process.env);
    if (!root || !fs.existsSync(root)) continue;
    let names: Record<string, string> = {};
    try { names = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(root, 'Local State'), 'utf8'))?.profile?.info_cache ?? {}).map(([k, v]: [string, any]) => [k, String(v?.name ?? k)])); } catch { /* no Local State */ }
    let dirs: string[] = [];
    try { dirs = fs.readdirSync(root).filter((d) => d === 'Default' || /^Profile \d+$/.test(d)); } catch { continue; }
    for (const d of dirs.sort()) {
      const cookiesPath = [path.join(root, d, 'Network', 'Cookies'), path.join(root, d, 'Cookies')].find((p) => fs.existsSync(p));
      if (!cookiesPath) continue;
      out.push({ browser: spec.id, browserLabel: spec.label, profile: d, name: names[d] ?? d, cookiesPath, source: `${spec.id}:${d}` });
    }
  }
  return out;
}

/** Pick a profile by '<browser>' (its Default, else its only profile) or '<browser>:<profile dir or shown name>'. */
export function pickChromeProfile(profiles: ChromeProfile[], spec = 'chrome'): ChromeProfile {
  const [b, p] = spec.split(':', 2) as [string, string | undefined];
  const mine = profiles.filter((x) => x.browser === b.toLowerCase());
  if (!mine.length) throw new Error(`no ${b} profile with a cookie database was found on this machine`);
  if (p === undefined) return mine.find((x) => x.profile === 'Default') ?? (mine.length === 1 ? mine[0]! : (() => { throw new Error(`${b} has several profiles — name one: ${mine.map((x) => `${b}:${x.profile} (${x.name})`).join(', ')}`); })());
  const hit = mine.find((x) => x.profile === p || x.name === p);
  if (!hit) throw new Error(`no ${b} profile "${p}" — have: ${mine.map((x) => `${x.profile} (${x.name})`).join(', ')}`);
  return hit;
}

// ── the database copy ───────────────────────────────────────────────────────
/** One cookies row, normalised. `expires_utc` here is SECONDS since 1601 (the DB stores µs). */
interface Row { host_key: string; name: string; value: string; encrypted_value: Uint8Array | null; path: string; expires_utc: number;
  is_secure: number; is_httponly: number; samesite: number; has_expires?: number; is_persistent?: number; top_frame_site_key?: string; has_cross_site_ancestor?: number }

async function withDbCopy<T>(cookiesPath: string, fn: (rows: Row[], version: number, hasXsa: boolean) => T): Promise<T> {
  let sqlite: any;
  // createRequire, not import(): bundlers/test runners rewrite 'node:sqlite' to a bare 'sqlite' (Vite) and fail to resolve it.
  try { sqlite = createRequire(import.meta.url)('node:sqlite'); } catch { throw new Error('importing browser sessions needs Node 22.13 or newer (node:sqlite)'); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-cookie-import-'));
  try {
    fs.chmodSync(dir, 0o700);
    const db = path.join(dir, 'Cookies');
    fs.copyFileSync(cookiesPath, db);
    for (const ext of ['-wal', '-journal', '-shm']) if (fs.existsSync(cookiesPath + ext)) fs.copyFileSync(cookiesPath + ext, db + ext);
    const conn = new sqlite.DatabaseSync(db, { readOnly: false });
    try {
      let version = 0;
      try { version = Number((conn.prepare("SELECT value FROM meta WHERE key = 'version'").get() as any)?.value ?? 0); } catch { /* no meta */ }
      const cols = new Set((conn.prepare('PRAGMA table_info(cookies)').all() as any[]).map((c) => String(c.name)));
      const want = ['host_key', 'name', 'value', 'encrypted_value', 'path', 'expires_utc', 'is_secure', 'is_httponly', 'samesite',
        'has_expires', 'is_persistent', 'top_frame_site_key', 'has_cross_site_ancestor'].filter((c) => cols.has(c));
      // expires_utc (µs since 1601) is above 2^53: read integers as BigInt, then normalise every numeric field explicitly.
      const stmt = conn.prepare(`SELECT ${want.join(', ')} FROM cookies`);
      stmt.setReadBigInts(true);
      const num = (v: unknown): number | undefined => (v === undefined || v === null ? undefined : Number(v));
      const rows = (stmt.all() as any[]).map((r): Row => ({
        host_key: String(r.host_key ?? ''), name: String(r.name ?? ''), value: typeof r.value === 'string' ? r.value : '',
        encrypted_value: r.encrypted_value instanceof Uint8Array ? r.encrypted_value : null, path: String(r.path ?? '/'),
        // to SECONDS since 1601 in BigInt first, so no precision is lost before the epoch shift
        expires_utc: typeof r.expires_utc === 'bigint' ? Number(r.expires_utc / 1_000_000n) : Math.floor(Number(r.expires_utc ?? 0) / 1e6),
        is_secure: num(r.is_secure) ?? 0, is_httponly: num(r.is_httponly) ?? 0, samesite: num(r.samesite) ?? -1,
        has_expires: num(r.has_expires), is_persistent: num(r.is_persistent),
        top_frame_site_key: typeof r.top_frame_site_key === 'string' ? r.top_frame_site_key : undefined, has_cross_site_ancestor: num(r.has_cross_site_ancestor),
      }));
      return fn(rows, version, cols.has('has_cross_site_ancestor'));
    } finally { conn.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** The sites a profile holds sessions for — names, counts and the sensitive mark only. Decrypts nothing, needs no key. */
export async function listImportableSites(profile: ChromeProfile): Promise<ImportableSite[]> {
  return withDbCopy(profile.cookiesPath, (rows) => {
    const counts = new Map<string, number>();
    for (const r of rows) { const s = registrableDomain(r.host_key); if (s) counts.set(s, (counts.get(s) ?? 0) + 1); }
    return [...counts].map(([site, cookies]) => ({ site, cookies, sensitive: isSensitiveSite(site) })).sort((a, b) => a.site.localeCompare(b.site));
  });
}

// ── decryption ──────────────────────────────────────────────────────────────
function defaultPassword(platform: NodeJS.Platform) {
  return (browser: ChromeBrowserId, version: 'v10' | 'v11'): string | null => {
    const spec = BROWSERS.find((b) => b.id === browser)!;
    if (platform === 'darwin') {
      // macOS shows its own Allow dialog for this item — the user's consent to the decrypt.
      try { return execFileSync('security', ['find-generic-password', '-w', '-s', spec.keychain], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
    }
    if (version === 'v10') return 'peanuts';
    try { return execFileSync('secret-tool', ['lookup', 'application', spec.libsecretApp], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
  };
}

/** Decrypt one Chrome `encrypted_value` (v10/v11). Returns null when it cannot be decrypted (wrong key, v20, garbage) — never throws a value. */
export function decryptChromeValue(enc: Uint8Array, key: Buffer, dbVersion: number, host?: string): string | null {
  const b = Buffer.from(enc);
  const tag = b.subarray(0, 3).toString('latin1');
  if (tag !== 'v10' && tag !== 'v11') return null;
  try {
    const d = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
    let out = Buffer.concat([d.update(b.subarray(3)), d.final()]);
    if (dbVersion >= 24) {
      // The prefix IS SHA-256(host_key): checking it (not just stripping it) proves the key was right — a wrong key passes the CBC
      // padding check about 1 time in 256 and would otherwise store garbage as a value.
      if (out.length < 32) return null;
      if (host !== undefined && !crypto.createHash('sha256').update(host).digest().equals(out.subarray(0, 32))) return null;
      out = out.subarray(32);
    }
    return out.toString('utf8');
  } catch { return null; }
}

export const chromeKey = (password: string, platform: NodeJS.Platform): Buffer =>
  crypto.pbkdf2Sync(password, 'saltysalt', platform === 'darwin' ? 1003 : 1, 16, 'sha1');

const SAMESITE: Record<number, VaultCookie['sameSite']> = { 0: 'None', 1: 'Lax', 2: 'Strict' };
const EPOCH_1601_S = 11644473600;

/**
 * Import the named sites from a profile into the session vault. One putSite() per site, importedAt = now (a re-import makes every older
 * grant stale — the store's identity rule). Returns per-site counts only. A site not in the profile, a public suffix, or a sensitive
 * site without allowSensitive is refused with the reason; cookies that cannot be decrypted or expressed are counted in `skipped`.
 */
export async function importChromeSites(profile: ChromeProfile, sites: string[], o: ImportOptions = {}): Promise<ImportResult> {
  const platform = o.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'linux') throw new Error(`importing ${profile.browserLabel} sessions is supported on macOS and Linux only (Windows uses DPAPI / app-bound encryption)`);
  const wanted = [...new Set(sites.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (!wanted.length) throw new Error('name the sites to import (there is no import-everything)');
  const getPassword = o.getPassword ?? defaultPassword(platform);
  const now = o.now ?? Date.now();
  const result: ImportResult = { profile: profile.source, imported: [], refused: [] };
  const allowed = new Set<string>();
  for (const s of wanted) {
    if (registrableDomain(s) !== s) { result.refused.push({ site: s, reason: 'not a registrable domain (name the site, e.g. github.com)' }); continue; }
    if (isSensitiveSite(s) && !o.allowSensitive) { result.refused.push({ site: s, reason: 'sensitive site (banking, email/identity, government, health, payments, passwords) — add --sensitive to import it' }); continue; }
    allowed.add(s);
  }
  if (!allowed.size) return result;

  const entries = await withDbCopy(profile.cookiesPath, (rows, version, hasXsa) => {
    const keys = new Map<'v10' | 'v11', Buffer | null>();
    const keyFor = (v: 'v10' | 'v11'): Buffer | null => {
      if (!keys.has(v)) { const pw = getPassword(profile.browser, v); keys.set(v, pw === null ? null : chromeKey(pw, platform)); }
      return keys.get(v)!;
    };
    const bySite = new Map<string, { cookies: VaultCookie[]; skipped: number }>();
    for (const r of rows) {
      const site = registrableDomain(r.host_key);
      if (!site || !allowed.has(site)) continue;
      const slot = bySite.get(site) ?? bySite.set(site, { cookies: [], skipped: 0 }).get(site)!;
      let value: string | null = r.value ?? '';
      const enc = r.encrypted_value;
      if (enc && enc.length) {
        const tag = Buffer.from(enc.subarray(0, 3)).toString('latin1');
        const key = tag === 'v10' || tag === 'v11' ? keyFor(tag) : null;
        value = key ? decryptChromeValue(enc, key, version, r.host_key) : null;
      }
      if (value === null) { slot.skipped++; continue; }
      const c: VaultCookie = { name: r.name, value, domain: r.host_key, path: r.path || '/', secure: !!r.is_secure, httpOnly: !!r.is_httponly };
      const persistent = (r.has_expires ?? 1) !== 0 && (r.is_persistent ?? 1) !== 0;
      const exp = Number(r.expires_utc);
      if (persistent && exp > 0) c.expires = exp - EPOCH_1601_S;
      const ss = SAMESITE[Number(r.samesite)];
      if (ss) c.sameSite = ss;
      if (r.top_frame_site_key) {
        if (!hasXsa) { slot.skipped++; continue; }   // a partition key without its flag would land in the wrong partition: skip, never guess
        c.partitionKey = { topLevelSite: r.top_frame_site_key, hasCrossSiteAncestor: !!r.has_cross_site_ancestor };
      }
      slot.cookies.push(c);
    }
    return bySite;
  });

  for (const site of allowed) {
    const got = entries.get(site);
    if (!got) { result.refused.push({ site, reason: `no cookies for ${site} in ${profile.source}` }); continue; }
    if (!got.cookies.length) { result.refused.push({ site, reason: `none of its ${got.skipped} cookie(s) could be decrypted (the Safe Storage key was refused or not found)` }); continue; }
    const exp = siteExpiresAt(got.cookies);   // latest real expiry (sessionVault) — the earliest made a site read "expired" in minutes
    const entry: SiteEntry = { site, cookies: got.cookies, source: profile.source, importedAt: now, ...(exp !== undefined ? { expiresAt: exp } : {}) };
    try { putSite(entry, o.vaultFile ?? sessionVaultPath(), o.env ?? process.env); }
    catch (e) { result.refused.push({ site, reason: (e as Error).message }); continue; }
    result.imported.push({ site, cookies: got.cookies.length, skipped: got.skipped });
  }
  return result;
}
