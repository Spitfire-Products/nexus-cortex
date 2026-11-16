/**
 * The Chrome-family session importer (vault T1 importer). A fabricated Chrome profile (Local State + Network/Cookies SQLite with real
 * v10 AES-128-CBC values, DB version 24 → SHA-256(host) prefix) in a temp HOME; the vault is a temp file with an explicit key. Nothing
 * touches the real ~/.cortex, a real browser or the Keychain.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import {
  findChromeProfiles, pickChromeProfile, listImportableSites, importChromeSites, registrableDomain, isSensitiveSite, decryptChromeValue, chromeKey,
} from './sessionImport.js';
import { listSites, getSiteForRelease } from './sessionVault.js';

const env = { CORTEX_SECRETS_KEY: 'test-master-secret-for-import' } as NodeJS.ProcessEnv;
let home: string; let vault: string;

const enc = (value: string, host: string, version: number, password = 'peanuts') => {
  const c = crypto.createCipheriv('aes-128-cbc', chromeKey(password, 'linux'), Buffer.alloc(16, 0x20));
  const plain = version >= 24 ? Buffer.concat([crypto.createHash('sha256').update(host).digest(), Buffer.from(value)]) : Buffer.from(value);
  return Buffer.concat([Buffer.from('v10'), c.update(plain), c.final()]);
};
const US_1601 = (epochS: number) => (BigInt(epochS) + 11644473600n) * 1_000_000n;   // > 2^53, as in a real DB

async function makeProfile(o: { version?: number; xsaColumn?: boolean; dir?: string } = {}) {
  const version = o.version ?? 24; const xsa = o.xsaColumn ?? true;
  const root = path.join(home, '.config', 'google-chrome');
  const prof = path.join(root, o.dir ?? 'Default', 'Network');
  fs.mkdirSync(prof, { recursive: true });
  fs.writeFileSync(path.join(root, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Person 1' } } } }));
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as any;
  const db = new DatabaseSync(path.join(prof, 'Cookies'));
  db.exec(`CREATE TABLE meta(key TEXT, value TEXT); INSERT INTO meta VALUES('version','${version}');
    CREATE TABLE cookies(host_key TEXT, top_frame_site_key TEXT, ${xsa ? 'has_cross_site_ancestor INTEGER,' : ''} name TEXT, value TEXT, encrypted_value BLOB,
      path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, has_expires INTEGER, is_persistent INTEGER, samesite INTEGER)`);
  const ins = db.prepare(`INSERT INTO cookies VALUES(?,?,${xsa ? '?,' : ''}?,?,?,?,?,?,?,?,?,?)`);
  const add = (host: string, name: string, value: string, x: { tfs?: string; xa?: number; exp?: number; ss?: number; plain?: boolean } = {}) =>
    ins.run(...[host, x.tfs ?? '', ...(xsa ? [x.xa ?? 0] : []), name, x.plain ? value : '', x.plain ? Buffer.alloc(0) : enc(value, host, version), '/',
      x.exp ? US_1601(x.exp) : 0n, 1, 1, x.exp ? 1 : 0, x.exp ? 1 : 0, x.ss ?? -1]);
  add('.github.com', 'user_session', 'GH-SECRET-1', { exp: 2_000_000_000, ss: 1 });
  add('github.com', '_gh_sess', 'GH-SECRET-2', { ss: 2 });                                  // session cookie, Strict
  add('.api.github.com', 'plainone', 'GH-PLAIN', { plain: true, ss: 0 });                  // unencrypted, SameSite=None
  add('embed.example.org', 'chip', 'CHIP-SECRET', { tfs: 'https://news.site', xa: 1 });   // partitioned (CHIPS)
  add('.chase.com', 'bank', 'BANK-SECRET', { exp: 2_000_000_000 });
  add('shop.example.co.uk', 'cart', 'UK-SECRET');
  add('192.168.1.1', 'router', 'R');
  db.close();
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-import-home-'));
  vault = path.join(home, 'vault.enc');
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const opts = (extra = {}) => ({ platform: 'linux' as const, vaultFile: vault, env, getPassword: () => 'peanuts', now: 1_800_000_000_000, ...extra });

describe('registrableDomain / isSensitiveSite', () => {
  it('folds hosts to the registrable domain, honours multi-part suffixes, refuses IPs and single labels', () => {
    expect(registrableDomain('.www.github.com')).toBe('github.com');
    expect(registrableDomain('shop.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('co.uk')).toBeNull();
    expect(registrableDomain('me.github.io')).toBe('me.github.io');
    expect(registrableDomain('192.168.1.1')).toBeNull();
    expect(registrableDomain('localhost')).toBeNull();
  });
  it('marks banking / identity / government as sensitive at a dot boundary', () => {
    expect(isSensitiveSite('chase.com')).toBe(true);
    expect(isSensitiveSite('google.com')).toBe(true);
    expect(isSensitiveSite('irs.gov')).toBe(true);
    expect(isSensitiveSite('notchase.com')).toBe(false);
    expect(isSensitiveSite('github.com')).toBe(false);
  });
});

describe('profiles + listing (names only, no key)', () => {
  it('finds the profile with its shown name and lists sites with counts and the sensitive mark', async () => {
    await makeProfile();
    const profiles = findChromeProfiles({ platform: 'linux', home, env: {} });
    expect(profiles).toHaveLength(1);
    const p = pickChromeProfile(profiles, 'chrome');
    expect(p).toMatchObject({ browser: 'chrome', profile: 'Default', name: 'Person 1', source: 'chrome:Default' });
    const sites = await listImportableSites(p);
    expect(sites).toEqual([
      { site: 'chase.com', cookies: 1, sensitive: true },
      { site: 'example.co.uk', cookies: 1, sensitive: false },
      { site: 'example.org', cookies: 1, sensitive: false },
      { site: 'github.com', cookies: 3, sensitive: false },
    ]);
    expect(JSON.stringify(sites)).not.toMatch(/SECRET/);
  });
  it('an unknown profile name is refused with the list', async () => {
    await makeProfile();
    expect(() => pickChromeProfile(findChromeProfiles({ platform: 'linux', home, env: {} }), 'chrome:Work')).toThrow(/no chrome profile "Work"/);
    expect(() => pickChromeProfile(findChromeProfiles({ platform: 'linux', home, env: {} }), 'brave')).toThrow(/no brave profile/);
  });
});

describe('importChromeSites', () => {
  it('decrypts only the named site, maps every field to the vault contract, returns counts only', async () => {
    await makeProfile();
    const p = pickChromeProfile(findChromeProfiles({ platform: 'linux', home, env: {} }));
    const r = await importChromeSites(p, ['github.com'], opts());
    expect(r).toEqual({ profile: 'chrome:Default', imported: [{ site: 'github.com', cookies: 3, skipped: 0 }], refused: [] });
    expect(JSON.stringify(r)).not.toMatch(/SECRET|PLAIN/);
    expect(listSites(vault).map((s) => s.site)).toEqual(['github.com']);
    const e = getSiteForRelease('github.com', vault, env);
    expect(e.source).toBe('chrome:Default');
    expect(e.importedAt).toBe(1_800_000_000_000);
    expect(e.expiresAt).toBe(2_000_000_000);
    const by = Object.fromEntries(e.cookies.map((c) => [c.name, c]));
    expect(by.user_session).toEqual({ name: 'user_session', value: 'GH-SECRET-1', domain: '.github.com', path: '/', secure: true, httpOnly: true, expires: 2_000_000_000, sameSite: 'Lax' });
    expect(by._gh_sess).toEqual({ name: '_gh_sess', value: 'GH-SECRET-2', domain: 'github.com', path: '/', secure: true, httpOnly: true, sameSite: 'Strict' });   // session: no expires
    expect(by.plainone.value).toBe('GH-PLAIN');
    expect(by.plainone.sameSite).toBe('None');
  });
  it('a partitioned cookie carries the OBJECT partitionKey with its flag', async () => {
    await makeProfile();
    const p = pickChromeProfile(findChromeProfiles({ platform: 'linux', home, env: {} }));
    await importChromeSites(p, ['example.org'], opts());
    const [c] = getSiteForRelease('example.org', vault, env).cookies;
    expect(c!.partitionKey).toEqual({ topLevelSite: 'https://news.site', hasCrossSiteAncestor: true });
    expect(c!.sameSite).toBeUndefined();   // unspecified is not 'Lax'
  });
  it('a partitioned cookie from a DB without has_cross_site_ancestor is skipped, never guessed', async () => {
    await makeProfile({ xsaColumn: false });
    const p = pickChromeProfile(findChromeProfiles({ platform: 'linux', home, env: {} }));
    const r = await importChromeSites(p, ['example.org'], opts());
    expect(r.imported).toEqual([]);
    expect(r.refused[0]!.reason).toMatch(/could be decrypted|none of its/);
  });
  it('sensitive sites need allowSensitive; public suffixes, unknown sites and an empty list are refused', async () => {
    await makeProfile();
    const p = pickChromeProfile(findChromeProfiles({ platform: 'linux', home, env: {} }));
    const r = await importChromeSites(p, ['chase.com', 'co.uk', 'nothere.com'], opts());
    expect(r.imported).toEqual([]);
    expect(r.refused.map((x) => x.site)).toEqual(['chase.com', 'co.uk', 'nothere.com']);
    expect(r.refused[0]!.reason).toMatch(/--sensitive/);
    expect(listSites(vault)).toEqual([]);
    const ok = await importChromeSites(p, ['chase.com'], opts({ allowSensitive: true }));
    expect(ok.imported).toEqual([{ site: 'chase.com', cookies: 1, skipped: 0 }]);
    await expect(importChromeSites(p, [], opts())).rejects.toThrow(/no import-everything/);
  });
  it('a wrong Safe Storage password decrypts nothing: refused, vault untouched, no value in the reason', async () => {
    await makeProfile();
    const p = pickChromeProfile(findChromeProfiles({ platform: 'linux', home, env: {} }));
    const r = await importChromeSites(p, ['github.com'], opts({ getPassword: () => 'wrong' }));
    // the plaintext cookie still imports; the two encrypted ones are skipped (bad padding → null)
    expect(r.imported).toEqual([{ site: 'github.com', cookies: 1, skipped: 2 }]);
    expect(JSON.stringify(r)).not.toMatch(/SECRET/);
  });
  it('DB versions before 24 have no host-hash prefix', async () => {
    await makeProfile({ version: 23 });
    const p = pickChromeProfile(findChromeProfiles({ platform: 'linux', home, env: {} }));
    await importChromeSites(p, ['example.co.uk'], opts());
    expect(getSiteForRelease('example.co.uk', vault, env).cookies[0]!.value).toBe('UK-SECRET');
  });
  it('Windows is refused with the reason; the temp DB copy is always removed', async () => {
    await makeProfile();
    const p = pickChromeProfile(findChromeProfiles({ platform: 'linux', home, env: {} }));
    await expect(importChromeSites(p, ['github.com'], opts({ platform: 'win32' }))).rejects.toThrow(/macOS and Linux only/);
    await importChromeSites(p, ['github.com'], opts());
    expect(fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('cortex-cookie-import-'))).toEqual([]);
  });
  it('decryptChromeValue rejects v20 / garbage without throwing', () => {
    const key = chromeKey('peanuts', 'linux');
    expect(decryptChromeValue(Buffer.from('v20xxxxxxxxxxxxxxxxx'), key, 24)).toBeNull();
    expect(decryptChromeValue(Buffer.from('v10short'), key, 24)).toBeNull();
    // v24: the right key but the wrong host fails the SHA-256(host) check
    expect(decryptChromeValue(enc('x', 'a.com', 24), key, 24, 'a.com')).toBe('x');
    expect(decryptChromeValue(enc('x', 'a.com', 24), key, 24, 'b.com')).toBeNull();
  });
});
