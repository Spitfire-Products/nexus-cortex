/**
 * sessionVault — the encrypted, engine-neutral browser-session store (plan: vault task T1).
 *
 * Every test runs in a fresh temp dir with an EXPLICIT env object: nothing here touches the real ~/.cortex, the real keychain
 * or the real vault. All values are obviously fake ('v-0001').
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  putSite, listSites, getSiteForRelease, revokeSite, appendReleaseLog,
  sessionVaultPath, releaseLogPath, SESSION_VAULT_KEY_ID,
  type SiteEntry, type VaultCookie,
} from './sessionVault.js';
import { deriveKey, encryptValue, decryptValue } from './secretsVault.js';

const MASTER = 'test-master-1';
const env = { CORTEX_SECRETS_KEY: MASTER } as NodeJS.ProcessEnv;

const cookie = (over: Partial<VaultCookie> = {}): VaultCookie => ({
  name: 'session', value: 'v-0001', domain: 'github.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', ...over,
});

const entry = (over: Partial<SiteEntry> = {}): SiteEntry => ({
  site: 'github.com',
  cookies: [cookie()],
  storage: { 'sb-theme': 'v-0002' },
  source: 'chrome:Default',
  importedAt: 1700000000000,
  expiresAt: 1800000000,
  ...over,
});

let dir: string;
let file: string;
let log: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-session-vault-'));
  file = path.join(dir, 'session-vault.enc');
  log = path.join(dir, 'session-vault-release.jsonl');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('defaults', () => {
  it('resolve to the global config dir, beside the secrets vault', () => {
    expect(sessionVaultPath()).toMatch(/\.cortex[/\\]session-vault\.enc$/);
    expect(releaseLogPath()).toMatch(/\.cortex[/\\]session-vault-release\.jsonl$/);
  });
});

describe('round-trip', () => {
  it('putSite → listSites → getSiteForRelease', () => {
    putSite(entry(), file, env);
    expect(listSites(file)).toEqual([{ site: 'github.com', source: 'chrome:Default', importedAt: 1700000000000, expiresAt: 1800000000, cookieCount: 1 }]);
    const got = getSiteForRelease('github.com', file, env);
    expect(got.site).toBe('github.com');
    expect(got.cookies).toEqual([cookie()]);
    expect(got.storage).toEqual({ 'sb-theme': 'v-0002' });
    expect(got.source).toBe('chrome:Default');
    expect(got.importedAt).toBe(1700000000000);
    expect(got.expiresAt).toBe(1800000000);
  });

  it('replaces a site, keeps the others, and the file is encrypted at rest', () => {
    putSite(entry(), file, env);
    putSite(entry({ site: 'example.org', cookies: [cookie({ domain: 'example.org', value: 'v-0003' })] }), file, env);
    putSite(entry({ cookies: [cookie({ value: 'v-0004' })] }), file, env);
    expect(listSites(file).map((s) => s.site).sort()).toEqual(['example.org', 'github.com']);
    expect(getSiteForRelease('github.com', file, env).cookies[0]!.value).toBe('v-0004');
    const raw = fs.readFileSync(file, 'utf8');
    for (const v of ['v-0001', 'v-0002', 'v-0003', 'v-0004', 'sb-theme']) expect(raw).not.toContain(v);
  });

  it('an empty / missing vault lists nothing instead of throwing', () => {
    expect(listSites(file)).toEqual([]);
  });
});

describe('key separation from the secrets vault', () => {
  it('derives a distinct key for the same master (the secrets vault keeps the default id)', () => {
    expect(SESSION_VAULT_KEY_ID).toBe('nexus-cortex-session-vault');
    expect(deriveKey(MASTER, SESSION_VAULT_KEY_ID).equals(deriveKey(MASTER))).toBe(false);
  });

  it('a session vault cannot be decrypted with the secrets vault key (default id)', () => {
    putSite(entry(), file, env);
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { check: never; sites: Record<string, { payload: never }> };
    expect(() => decryptValue(deriveKey(MASTER), data.check)).toThrow();                 // a key that opens secrets.enc does not open this
    expect(() => decryptValue(deriveKey(MASTER), data.sites['github.com']!.payload)).toThrow();
    expect(() => decryptValue(deriveKey(MASTER, SESSION_VAULT_KEY_ID), data.check)).not.toThrow();
  });

  it('a vault written with the secrets vault key (default id) is refused as a session vault', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, check: encryptValue(deriveKey(MASTER), 'nexus-cortex-session-vault-ok'), sites: {} }), { mode: 0o600 });
    expect(() => putSite(entry(), file, env)).toThrow(/wrong key/i);
    expect(() => getSiteForRelease('github.com', file, env)).toThrow(/wrong key|no site/i);
  });
});

describe('listSites never reveals values', () => {
  it('metadata only — no cookie value, no storage value', () => {
    putSite(entry({ cookies: [cookie({ value: 'v-0001' }), cookie({ name: 'other', value: 'v-0005' })] }), file, env);
    const text = JSON.stringify(listSites(file));
    expect(text).not.toContain('v-0001');
    expect(text).not.toContain('v-0005');
    expect(text).not.toContain('v-0002');
    expect(text).not.toContain('sb-theme');
    expect(Object.keys(listSites(file)[0]!).sort()).toEqual(['cookieCount', 'expiresAt', 'importedAt', 'site', 'source']);
  });
});

describe('revokeSite', () => {
  it('removes the entry and leaves the rest', () => {
    putSite(entry(), file, env);
    putSite(entry({ site: 'example.org', cookies: [cookie({ domain: 'example.org' })] }), file, env);
    expect(revokeSite('github.com', file)).toBe(true);
    expect(listSites(file).map((s) => s.site)).toEqual(['example.org']);
    expect(() => getSiteForRelease('github.com', file, env)).toThrow(/no site/);
    expect(revokeSite('github.com', file)).toBe(false);
  });
});

describe('wrong key', () => {
  it('throws a clear error and leaves the vault untouched', () => {
    putSite(entry(), file, env);
    const before = fs.readFileSync(file);
    expect(() => getSiteForRelease('github.com', file, { CORTEX_SECRETS_KEY: 'other-master-9' } as NodeJS.ProcessEnv)).toThrow(/wrong .*key/i);
    expect(() => putSite(entry(), file, { CORTEX_SECRETS_KEY: 'other-master-9' } as NodeJS.ProcessEnv)).toThrow(/wrong .*key/i);
    expect(fs.readFileSync(file).equals(before)).toBe(true);          // no partial data
    expect(getSiteForRelease('github.com', file, env).cookies[0]!.value).toBe('v-0001');
  });

  it('unlocks from CORTEX_SECRETS_KEY_FILE too (the orchestrator path)', () => {
    putSite(entry(), file, env);
    const keyFile = path.join(dir, 'master.key');
    fs.writeFileSync(keyFile, MASTER + '\n', { mode: 0o600 });
    expect(getSiteForRelease('github.com', file, { CORTEX_SECRETS_KEY_FILE: keyFile } as NodeJS.ProcessEnv).cookies[0]!.value).toBe('v-0001');
  });
});

describe('file handling', () => {
  it('is mode 0600 and its directory 0700', () => {
    putSite(entry(), file, env);
    expect((fs.statSync(file).mode & 0o777).toString(8)).toBe('600');
    expect((fs.statSync(dir).mode & 0o077)).toBe(0);
  });

  it('writes atomically — a failed write leaves the previous vault intact and no temp file behind', () => {
    putSite(entry(), file, env);
    const before = fs.readFileSync(file);
    expect(() => putSite(entry({ cookies: [cookie({ value: 'v-0009' })] }), file, env, {
      writeTmp: (tmp) => { fs.writeFileSync(tmp, '{"version":1,"trunc'); throw new Error('simulated disk full'); },
    })).toThrow(/simulated disk full/);
    expect(fs.readFileSync(file).equals(before)).toBe(true);           // never a half-written vault
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]);
    expect(getSiteForRelease('github.com', file, env).cookies[0]!.value).toBe('v-0001');
    putSite(entry({ cookies: [cookie({ value: 'v-0009' })] }), file, env);   // still usable
    expect(getSiteForRelease('github.com', file, env).cookies[0]!.value).toBe('v-0009');
  });
});

describe('input validation', () => {
  it('refuses an empty site and a site containing /', () => {
    expect(() => putSite(entry({ site: '' }), file, env)).toThrow(/site/i);
    expect(() => putSite(entry({ site: '  ' }), file, env)).toThrow(/site/i);
    expect(() => putSite(entry({ site: 'github.com/login' }), file, env)).toThrow(/site/i);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('refuses a cookie domain that is not the site or a subdomain of it', () => {
    expect(() => putSite(entry({ cookies: [cookie({ domain: 'evil.example' })] }), file, env)).toThrow(/domain/i);
    expect(() => putSite(entry({ cookies: [cookie({ domain: 'notgithub.com' })] }), file, env)).toThrow(/domain/i);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('refuses a single-label site — a registrable domain has at least one dot', () => {
    expect(() => putSite(entry({ site: 'com', cookies: [cookie({ domain: 'com' })] }), file, env)).toThrow(/site/i);
    expect(() => putSite(entry({ site: 'localhost', cookies: [cookie({ domain: 'localhost' })] }), file, env)).toThrow(/site/i);
    expect(fs.existsSync(file)).toBe(false);
    putSite(entry(), file, env);                                   // 'github.com' is still accepted
    expect(listSites(file)[0]!.site).toBe('github.com');
  });

  it('refuses an importedAt that is not a finite number', () => {
    for (const importedAt of [NaN, Infinity, -Infinity, '1700000000000' as never, undefined as never, null as never]) {
      expect(() => putSite(entry({ importedAt: importedAt as number }), file, env)).toThrow(/importedAt/i);
    }
    expect(fs.existsSync(file)).toBe(false);
  });

  it('refuses a sameSite that is present but not Strict, Lax or None', () => {
    expect(() => putSite(entry({ cookies: [cookie({ sameSite: 'Laxx' as never })] }), file, env)).toThrow(/sameSite/i);
    expect(() => putSite(entry({ cookies: [cookie({ sameSite: '' as never })] }), file, env)).toThrow(/sameSite/i);
    expect(fs.existsSync(file)).toBe(false);
    putSite(entry({ cookies: [cookie({ sameSite: 'None' })] }), file, env);          // a valid entry still works
    expect(getSiteForRelease('github.com', file, env).cookies[0]!.sameSite).toBe('None');
  });

  it('accepts the site itself, a subdomain, and the leading-dot form browsers write', () => {
    putSite(entry({ cookies: [cookie({ domain: 'github.com' }), cookie({ domain: 'api.github.com' }), cookie({ domain: '.github.com' })] }), file, env);
    expect(listSites(file)[0]!.cookieCount).toBe(3);
  });
});

describe('appendReleaseLog', () => {
  it('records site + mode + time only, never a value', () => {
    putSite(entry(), file, env);
    appendReleaseLog({ site: 'github.com', mode: 'once', at: 1700000001000, task: 'task-7' }, log);
    appendReleaseLog({ site: 'github.com', mode: 'session', at: 1700000002000 }, log);
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { site: 'github.com', mode: 'once', at: 1700000001000, task: 'task-7' },
      { site: 'github.com', mode: 'session', at: 1700000002000 },
    ]);
    const text = fs.readFileSync(log, 'utf8');
    for (const v of ['v-0001', 'v-0002', 'session=v', 'sb-theme']) expect(text).not.toContain(v);
    expect((fs.statSync(log).mode & 0o777).toString(8)).toBe('600');
  });

  it('keeps a task only when it matches ^[A-Za-z0-9._:-]{1,64}$ — anything else is dropped, never stored', () => {
    appendReleaseLog({ site: 'github.com', mode: 'once', at: 1, task: 'run-7:build.v2_a' }, log);
    expect(JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n')[0]!).task).toBe('run-7:build.v2_a');
    const bad = ['has space', 'a/b', 'a=b', 'x'.repeat(65), '', 'quote"', 'café-ü'];
    for (const task of bad) appendReleaseLog({ site: 'github.com', mode: 'once', at: 2, task }, log);
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1 + bad.length);                       // every release is still logged
    for (const l of lines.slice(1)) expect('task' in l).toBe(false);  // …without the value
  });

  it('refuses an unknown mode and an invalid site', () => {
    expect(() => appendReleaseLog({ site: 'github.com', mode: 'forever' as never, at: 1 }, log)).toThrow(/mode/i);
    expect(() => appendReleaseLog({ site: 'github.com/x', mode: 'once', at: 1 }, log)).toThrow(/site/i);
    expect(fs.existsSync(log)).toBe(false);
  });
});
