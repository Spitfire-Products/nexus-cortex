/**
 * Saved sign-ins under YOLO (operator 2026-11-15, decision 4): an automatic approval handler never answers the load_session question;
 * a standing 'always' grant still loads; a person's handler is still asked; other tools under YOLO are unchanged.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { putSite, type SiteEntry } from '../../config/sessionVault.js';
import { setGrant, clearSessionGrants, clearPreApprovals, takePreApproval } from '../../config/sessionRelease.js';
import { PermissionsMiddleware } from '../PermissionsMiddleware.js';
import { AutoApproveHandler } from './AutoApproveHandler.js';
import { loadSessionFloorPolicy } from './DefaultPolicies.js';

const env = { CORTEX_SECRETS_KEY: 'test-master-1' } as NodeJS.ProcessEnv;
const entry = { site: 'github.com', source: 'chrome:Default', importedAt: 1700000000000,
  cookies: [{ name: 's', value: 'v-SECRET', domain: 'github.com', path: '/', expires: 1900000000, secure: true, httpOnly: true, sameSite: 'Lax' }] } as SiteEntry;
let dir: string, vaultFile: string, grantsFile: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-yolo-')); vaultFile = path.join(dir, 'v.enc'); grantsFile = path.join(dir, 'g.json');
  clearSessionGrants(); clearPreApprovals(); putSite(entry, vaultFile, env);
});
afterEach(() => { clearSessionGrants(); clearPreApprovals(); fs.rmSync(dir, { recursive: true, force: true }); });

const ctx = { sessionId: 's1', approvalMode: { autoApproveActions: false } } as any;
const mw = (handler: any) => new PermissionsMiddleware({ policies: [loadSessionFloorPolicy({ vaultFile, grantsFile })], approvalHandler: handler } as any);

describe('load_session under YOLO', () => {
  it('YOLO handler + no grant → refused at once, nothing recorded for the release', async () => {
    const d = await mw(new AutoApproveHandler({ enableLogging: false })).checkPermission('nexus-browser__load_session', { site: 'github.com' }, ctx);
    expect(d.allowed).toBe(false);
    expect(String((d as any).reason)).toMatch(/YOLO answers every prompt/);
    expect(takePreApproval({ site: 'github.com', importedAt: 1700000000000, sessionId: 's1' })).toBeUndefined();
  });
  it("YOLO handler + a standing 'always' grant → allowed (unattended runs use granted sites)", async () => {
    setGrant('github.com', 1700000003000, 1700000000000, grantsFile);
    const d = await mw(new AutoApproveHandler({ enableLogging: false })).checkPermission('nexus-browser__load_session', { site: 'github.com' }, ctx);
    expect(d.allowed).toBe(true);
  });
  it("a person's handler is still asked (and its yes is honoured)", async () => {
    let asked = 0;
    const d = await mw({ requestApproval: async () => { asked++; return { approved: true, scope: 'once' }; } })
      .checkPermission('nexus-browser__load_session', { site: 'github.com' }, ctx);
    expect(asked).toBe(1); expect(d.allowed).toBe(true);
  });
  it('other tools under YOLO are unchanged (the YOLO handler still approves them)', async () => {
    const m = new PermissionsMiddleware({ policies: [{ name: 'p', priority: 10, enabled: true, evaluate: async () => ({ allowed: false, canApprove: true, tier: 'blacklist', reason: 'x' }) }], approvalHandler: new AutoApproveHandler({ enableLogging: false }) } as any);
    expect((await m.checkPermission('Bash', { command: 'ls' }, ctx)).allowed).toBe(true);
  });
});
