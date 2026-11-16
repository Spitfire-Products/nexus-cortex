/**
 * floor-load-session through PermissionsMiddleware (vault task T3) — the spec's real criterion: the floor must behave as the
 * middleware runs it, not only as a bare function. Temp vault/grants files; never ~/.cortex.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { putSite, type SiteEntry, type VaultCookie } from '../../config/sessionVault.js';
import { setGrant, clearSessionGrants } from '../../config/sessionRelease.js';
import { PermissionsMiddleware } from '../PermissionsMiddleware.js';
import { loadSessionFloorPolicy } from './DefaultPolicies.js';

const env = { CORTEX_SECRETS_KEY: 'test-master-1' } as NodeJS.ProcessEnv;
const cookie = (over: Partial<VaultCookie> = {}): VaultCookie => ({
  name: 'session', value: 'v-0001', domain: 'github.com', path: '/', expires: 1800000000,
  secure: true, httpOnly: true, sameSite: 'Lax', ...over,
});
const entry = (over: Partial<SiteEntry> = {}): SiteEntry => ({
  site: 'github.com', cookies: [cookie()], source: 'chrome:Default', importedAt: 1700000000000, ...over,
});

let dir: string, vaultFile: string, grantsFile: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-floor-load-session-'));
  vaultFile = path.join(dir, 'session-vault.enc');
  grantsFile = path.join(dir, 'session-vault-grants.json');
  clearSessionGrants();
});
afterEach(() => { clearSessionGrants(); fs.rmSync(dir, { recursive: true, force: true }); });

const mw = (bypassAll = false) =>
  new PermissionsMiddleware({ policies: [loadSessionFloorPolicy({ vaultFile, grantsFile })], bypassAll });
const check = (m: PermissionsMiddleware, site: string, autoApproveActions?: boolean) =>
  m.checkPermission('nexus-browser__load_session', { site }, { sessionId: 's1', approvalMode: autoApproveActions === undefined ? undefined : { autoApproveActions } } as any);

describe('floor-load-session', () => {
  it('applies to the bare name too', async () => {
    putSite(entry(), vaultFile, env);
    const d = await mw().checkPermission('load_session', { site: 'github.com' }, { sessionId: 's1', approvalMode: { autoApproveActions: true } } as any);
    expect(d.allowed).toBe(false);
  });

  it('auto-approve ON + no grant → refused at once with the floor reason, ask never called, nothing set', async () => {
    putSite(entry(), vaultFile, env);
    const d = await check(mw(), 'github.com', true);
    expect(d.allowed).toBe(false);
    expect(String((d as { reason?: string }).reason)).toContain('no standing grant for github.com - the user grants it once in the TUI');
    expect(fs.existsSync(grantsFile)).toBe(false);
  });

  it('headless (bypassAll, no approval handler) → refused at once', async () => {
    putSite(entry(), vaultFile, env);
    const d = await check(mw(true), 'github.com');
    expect(d.allowed).toBe(false);
    expect(String((d as { reason?: string }).reason)).toContain('no standing grant for github.com');
  });

  it('auto-approve ON + valid always grant → allowed without any prompt', async () => {
    putSite(entry(), vaultFile, env);
    setGrant('github.com', 1700000003000, 1700000000000, grantsFile);
    await expect(check(mw(), 'github.com', true)).resolves.toMatchObject({ allowed: true });
    await expect(check(mw(true), 'github.com')).resolves.toMatchObject({ allowed: true });
  });

  it('a stale grant (different importedAt) is not a standing grant', async () => {
    putSite(entry(), vaultFile, env);
    setGrant('github.com', 1700000003000, 1600000000000, grantsFile);
    const d = await check(mw(), 'github.com', true);
    expect(d.allowed).toBe(false);
  });

  it('a site that is not in the vault is allowed (release loads 0 and asks nothing)', async () => {
    await expect(check(mw(), 'example.org', true)).resolves.toMatchObject({ allowed: true });
  });

  it('does not touch any other tool', async () => {
    await expect(mw().checkPermission('Bash', { command: 'ls' }, { sessionId: 's1' } as any)).resolves.toMatchObject({ allowed: true });
  });
});
