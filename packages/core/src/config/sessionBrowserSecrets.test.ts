/**
 * sessionBrowserSecrets — the library behind `cortex browser-secrets` (vault T3). Temp dir + explicit env; never ~/.cortex.
 * The fixture values ('v-0001' …) are asserted AGAINST: the list output must not contain them.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { putSite, type SiteEntry, type VaultCookie } from './sessionVault.js';
import { clearSessionGrants, setGrant, readGrant } from './sessionRelease.js';
import { listBrowserSecrets, revokeBrowserSecret } from './sessionBrowserSecrets.js';

const env = { CORTEX_SECRETS_KEY: 'test-master-1' } as NodeJS.ProcessEnv;
const cookie = (over: Partial<VaultCookie> = {}): VaultCookie => ({
  name: 'session', value: 'v-0001', domain: 'github.com', path: '/', expires: 1800000000,
  secure: true, httpOnly: true, sameSite: 'Lax', ...over,
});
const entry = (over: Partial<SiteEntry> = {}): SiteEntry => ({
  site: 'github.com', cookies: [cookie()], storage: { 'sb-theme': 'v-0002' }, source: 'chrome:Default', importedAt: 1700000000000, ...over,
});

let dir: string, vaultFile: string, grantsFile: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-browser-secrets-'));
  vaultFile = path.join(dir, 'session-vault.enc');
  grantsFile = path.join(dir, 'session-vault-grants.json');
  clearSessionGrants();
});
afterEach(() => { clearSessionGrants(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('listBrowserSecrets', () => {
  it('reports site, cookie count, importedAt and grant — and NEVER a value', () => {
    putSite(entry(), vaultFile, env);
    putSite(entry({ site: 'example.org', cookies: [cookie({ domain: 'example.org', value: 'v-0003' })], importedAt: 1700000002000 }), vaultFile, env);
    setGrant('github.com', 1700000003000, 1700000000000, grantsFile);

    const rows = listBrowserSecrets({ vaultFile, grantsFile });
    expect(rows).toEqual([
      { site: 'example.org', cookieCount: 1, importedAt: 1700000002000, expiresAt: 1800000000, expired: false, expiringSoon: false, grant: 'none' },
      { site: 'github.com', cookieCount: 1, importedAt: 1700000000000, expiresAt: 1800000000, expired: false, expiringSoon: false, grant: 'always' },
    ]);
    const printed = JSON.stringify(rows);
    for (const v of ['v-0001', 'v-0002', 'v-0003']) expect(printed).not.toContain(v);
  });

  it('is empty for a vault that does not exist yet', () => {
    expect(listBrowserSecrets({ vaultFile, grantsFile })).toEqual([]);
  });
});

describe('revokeBrowserSecret', () => {
  it('removes the vault entry AND its grant, and prints nothing about values', async () => {
    putSite(entry(), vaultFile, env);
    setGrant('github.com', 1700000003000, 1700000000000, grantsFile);
    expect(readGrant('github.com', grantsFile)).toBe('always');

    const res = await revokeBrowserSecret('github.com', { vaultFile, grantsFile });
    expect(res).toEqual({ site: 'github.com', revoked: true, grantCleared: true });
    expect(listBrowserSecrets({ vaultFile, grantsFile })).toEqual([]);
    expect(readGrant('github.com', grantsFile)).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain('v-0001');
  });

  it('reports nothing removed for an unknown site', async () => {
    await expect(revokeBrowserSecret('example.org', { vaultFile, grantsFile }))
      .resolves.toEqual({ site: 'example.org', revoked: false, grantCleared: false });
  });
});
