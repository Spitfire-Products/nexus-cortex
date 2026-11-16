/**
 * T4 — the /sessions menu's library: grant always / this session / none from a person at the menu, ahead of a scheduled task.
 * Temp files + explicit env; never ~/.cortex. Values are asserted AGAINST everywhere (metadata only).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { putSite, type SiteEntry } from './sessionVault.js';
import { clearSessionGrants, hasSessionGrant, readGrantForSite } from './sessionRelease.js';
import { listBrowserSecrets, grantBrowserSecret, revokeBrowserSecret } from './sessionBrowserSecrets.js';
import { loadSessionFloorPolicy } from '../middleware/permissions/DefaultPolicies.js';

const env = { CORTEX_SECRETS_KEY: 'test-master-1' } as NodeJS.ProcessEnv;
const entry = (over: Partial<SiteEntry> = {}): SiteEntry => ({
  site: 'github.com', source: 'chrome:Default', importedAt: 1700000000000,
  cookies: [{ name: 'session', value: 'v-SECRET-1', domain: 'github.com', path: '/', expires: 1900000000, secure: true, httpOnly: true, sameSite: 'Lax' }],
  ...over,
} as SiteEntry);

let dir: string, vaultFile: string, grantsFile: string;
const o = (extra: Record<string, unknown> = {}) => ({ vaultFile, grantsFile, ...extra });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-t4-'));
  vaultFile = path.join(dir, 'session-vault.enc'); grantsFile = path.join(dir, 'grants.json');
  clearSessionGrants(); putSite(entry(), vaultFile, env);
});
afterEach(() => { clearSessionGrants(); fs.rmSync(dir, { recursive: true, force: true }); });

const floorAllows = async (sessionId: string, autoApprove = true) => {
  const d = await loadSessionFloorPolicy({ vaultFile, grantsFile }).evaluate({ toolName: 'nexus-browser__load_session', toolInput: { site: 'github.com' }, sessionId, approvalMode: { autoApproveActions: autoApprove } } as any);
  return d.allowed === true;
};

describe('grantBrowserSecret', () => {
  it("'always' from the menu = a standing grant bound to the current import → a scheduled (auto-approve) turn loads it with nobody asked", async () => {
    expect(await floorAllows('sched-1')).toBe(false);
    const row = grantBrowserSecret('GitHub.com ', 'always', o());
    expect(row.grant).toBe('always');
    expect(readGrantForSite('github.com', grantsFile)).toMatchObject({ mode: 'always', importedAt: 1700000000000 });
    expect(await floorAllows('sched-1')).toBe(true);
    expect(await floorAllows('another-session')).toBe(true);
  });
  it("a re-import makes the 'always' grant stale: listed as none, floor refuses again", async () => {
    grantBrowserSecret('github.com', 'always', o());
    putSite(entry({ importedAt: 1700000009000 }), vaultFile, env);
    expect(listBrowserSecrets(o())[0].grant).toBe('none');
    expect(await floorAllows('sched-1')).toBe(false);
  });
  it("'session' needs the caller's session id and is honoured for THAT session only, never written to disk", async () => {
    expect(() => grantBrowserSecret('github.com', 'session', o())).toThrow(/needs the running agent session/);
    const row = grantBrowserSecret('github.com', 'session', o({ sessionId: 'tui-1' }));
    expect(row.grant).toBe('session');
    expect(hasSessionGrant('github.com', 1700000000000, 'tui-1')).toBe(true);
    expect(readGrantForSite('github.com', grantsFile)).toBeUndefined();
    expect(await floorAllows('tui-1')).toBe(true);
    expect(await floorAllows('other')).toBe(false);
    expect(listBrowserSecrets(o({ sessionId: 'other' }))[0].grant).toBe('none');
    expect(listBrowserSecrets(o({ sessionId: 'tui-1' }))[0].grant).toBe('session');
  });
  it("'session' replaces an 'always' grant and vice versa; 'none' clears both", async () => {
    grantBrowserSecret('github.com', 'always', o());
    grantBrowserSecret('github.com', 'session', o({ sessionId: 'tui-1' }));
    expect(readGrantForSite('github.com', grantsFile)).toBeUndefined();
    grantBrowserSecret('github.com', 'always', o());
    expect(hasSessionGrant('github.com', 1700000000000, 'tui-1')).toBe(false);
    grantBrowserSecret('github.com', 'none', o({ sessionId: 'tui-1' }));
    expect(readGrantForSite('github.com', grantsFile)).toBeUndefined();
    expect(await floorAllows('tui-1')).toBe(false);
  });
  it('refuses a site that is not saved and an unknown scope; never puts a value in a result or an error', () => {
    expect(() => grantBrowserSecret('example.org', 'always', o())).toThrow(/no saved sign-in for example.org/);
    expect(() => grantBrowserSecret('github.com', 'forever' as any, o())).toThrow(/unknown grant/);
    expect(JSON.stringify(listBrowserSecrets(o()))).not.toContain('v-SECRET-1');
    expect(JSON.stringify(grantBrowserSecret('github.com', 'always', o()))).not.toContain('v-SECRET-1');
  });
  it('the row reports expiry metadata (expired when every cookie is past its expiry)', () => {
    putSite(entry({ site: 'old.example', cookies: [{ name: 'a', value: 'v-SECRET-2', domain: 'old.example', path: '/', expires: 1000, secure: true, httpOnly: true, sameSite: 'Lax' } as any] }), vaultFile, env);
    const rows = listBrowserSecrets(o({ now: 1800000000000 }));
    expect(rows.find((r) => r.site === 'old.example')?.expired).toBe(true);
    expect(rows.find((r) => r.site === 'github.com')?.expired).toBe(false);
  });
  it('revoke removes the entry and every grant', async () => {
    grantBrowserSecret('github.com', 'session', o({ sessionId: 'tui-1' }));
    await revokeBrowserSecret('github.com', o());
    expect(listBrowserSecrets(o())).toEqual([]);
    expect(hasSessionGrant('github.com', 1700000000000, 'tui-1')).toBe(false);
  });
});
