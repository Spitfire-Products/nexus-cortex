/**
 * Interactive load_session end to end (vault task T3, defect D2): ONE question per release.
 *
 * Through the REAL PermissionsMiddleware with the REAL floor policy and a fake approval handler: the floor's dialog IS the
 * four-way ask, its answer is recorded as a pre-approval, and releaseSite consumes it instead of asking a second time
 * (`ask` is a stub that throws if it is ever called).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { putSite, type SiteEntry, type VaultCookie } from '../../config/sessionVault.js';
import {
  clearSessionGrants, clearPreApprovals, readGrant, takePreApproval,
} from '../../config/sessionRelease.js';
import { runLoadSession } from '../../config/sessionLoadTool.js';
import { PermissionsMiddleware } from '../PermissionsMiddleware.js';
import { loadSessionFloorPolicy } from './DefaultPolicies.js';
import type { ApprovalAnswer, ApprovalRequest } from '../contracts/MiddlewareContracts.js';

const env = { CORTEX_SECRETS_KEY: 'test-master-1' } as NodeJS.ProcessEnv;
const cookie = (over: Partial<VaultCookie> = {}): VaultCookie => ({
  name: 'session', value: 'v-0001', domain: 'github.com', path: '/', expires: 1800000000,
  secure: true, httpOnly: true, sameSite: 'Lax', ...over,
});
const entry = (over: Partial<SiteEntry> = {}): SiteEntry => ({
  site: 'github.com', cookies: [cookie()], source: 'chrome:Default', importedAt: 1700000000000, ...over,
});

let dir: string, vaultFile: string, grantsFile: string, logFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-load-session-interactive-'));
  vaultFile = path.join(dir, 'session-vault.enc');
  grantsFile = path.join(dir, 'session-vault-grants.json');
  logFile = path.join(dir, 'session-release.log');
  clearSessionGrants();
  clearPreApprovals();
});
afterEach(() => {
  clearSessionGrants();
  clearPreApprovals();
  fs.rmSync(dir, { recursive: true, force: true });
});

interface FakeHandler {
  calls: ApprovalRequest[];
  requestApproval(req: ApprovalRequest): Promise<ApprovalAnswer>;
}

const handlerAnswering = (answer: ApprovalAnswer): FakeHandler => {
  const calls: ApprovalRequest[] = [];
  return {
    calls,
    requestApproval: async (req: ApprovalRequest) => { calls.push(req); return answer; },
  };
};

const middleware = (h: FakeHandler) => new PermissionsMiddleware({
  policies: [loadSessionFloorPolicy({ vaultFile, grantsFile })],
  approvalHandler: h as any,
});

const interactive = { sessionId: 's1', approvalMode: { autoApproveActions: false } } as any;

/** A CDP session that records what it was told; never a real browser. */
const fakeCdp = () => {
  const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  return { sent, send: async (method: string, params?: Record<string, unknown>) => { sent.push({ method, params }); return {}; } };
};

/** The tool's own ask: it must never be reached in the interactive flow (that is the double prompt). */
const askThatThrows = (): never => { throw new Error('releaseSite asked a second time (double prompt)'); };

/**
 * Run the tool for the site. `mode` is what the CALLER asks for: the user's answer can only narrow it (releaseSite's existing
 * rule), so a caller that wants a standing grant asks for `mode: 'always'` — a 'once' request caps the answer at 'once'.
 */
const release = (cdp: ReturnType<typeof fakeCdp>, mode: 'once' | 'session' | 'always' = 'once') => runLoadSession(
  { site: 'github.com', mode }, cdp as any,
  // `sessionId` is the permission context's: the pre-approval is bound to the session that answered the dialog (rev 4).
  { ask: askThatThrows as any, vaultFile, logFile, grantsFile, env, sessionId: 's1' },
);

const check = (m: PermissionsMiddleware) =>
  m.checkPermission('nexus-browser__load_session', { site: 'github.com' }, interactive);

describe('interactive load_session: one question per release (D2)', () => {
  it("scope 'always': ONE approval call, the grant is written, cookies are set, the next call asks nothing", async () => {
    putSite(entry(), vaultFile, env);
    const h = handlerAnswering({ approved: true, scope: 'always' });
    const m = middleware(h);

    await expect(check(m)).resolves.toMatchObject({ allowed: true });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.kind).toBe('load_session');
    expect(h.calls[0]!.site).toBe('github.com');
    expect(h.calls[0]!.choices?.map((c) => c.value)).toEqual(['once', 'session', 'always', 'no']);

    const cdp = fakeCdp();
    await expect(release(cdp, 'always')).resolves.toEqual({ site: 'github.com', loaded: 1 });
    expect(cdp.sent).toHaveLength(1);
    expect(cdp.sent[0]!.method).toBe('Network.setCookies');
    expect(readGrant('github.com', grantsFile)).toBe('always');

    // Second turn: the standing grant releases it with no dialog at all.
    await expect(check(m)).resolves.toMatchObject({ allowed: true });
    expect(h.calls).toHaveLength(1);
    const cdp2 = fakeCdp();
    await expect(release(cdp2, 'always')).resolves.toEqual({ site: 'github.com', loaded: 1 });
    expect(cdp2.sent).toHaveLength(1);
  });

  it("scope 'once': released, no grant on disk, no session grant", async () => {
    putSite(entry(), vaultFile, env);
    const h = handlerAnswering({ approved: true, scope: 'once' });
    const m = middleware(h);

    await expect(check(m)).resolves.toMatchObject({ allowed: true });
    const cdp = fakeCdp();
    await expect(release(cdp)).resolves.toEqual({ site: 'github.com', loaded: 1 });
    expect(cdp.sent).toHaveLength(1);
    expect(readGrant('github.com', grantsFile)).toBeUndefined();
    expect(fs.existsSync(grantsFile)).toBe(false);
  });

  it("scope 'session': released, no disk grant, the next release in this process asks nothing", async () => {
    putSite(entry(), vaultFile, env);
    const h = handlerAnswering({ approved: true, scope: 'session' });
    const m = middleware(h);

    await expect(check(m)).resolves.toMatchObject({ allowed: true });
    await expect(release(fakeCdp(), 'session')).resolves.toEqual({ site: 'github.com', loaded: 1 });
    expect(readGrant('github.com', grantsFile)).toBeUndefined();

    const cdp2 = fakeCdp();
    await expect(release(cdp2, 'session')).resolves.toEqual({ site: 'github.com', loaded: 1 });
    expect(cdp2.sent).toHaveLength(1);
    expect(h.calls).toHaveLength(1);
  });

  it("answer false ('no'): nothing set, nothing logged, no grant, nothing released", async () => {
    putSite(entry(), vaultFile, env);
    const h = handlerAnswering(false);
    const m = middleware(h);

    const d = await check(m);
    expect(d.allowed).toBe(false);
    expect(h.calls).toHaveLength(1);

    const cdp = fakeCdp();
    // releaseSite is reached only after a positive decision; if it were, the ask stub throws.
    await expect(release(cdp)).rejects.toThrow(/double prompt/);
    expect(cdp.sent).toHaveLength(0);
    expect(fs.existsSync(logFile)).toBe(false);
    expect(fs.existsSync(grantsFile)).toBe(false);
  });

  it("answer {approved:false, scope:'always'}: nothing recorded", async () => {
    putSite(entry(), vaultFile, env);
    const h = handlerAnswering({ approved: false, scope: 'always' });
    const m = middleware(h);

    await expect(check(m)).resolves.toMatchObject({ allowed: false });
    const cdp = fakeCdp();
    await expect(release(cdp)).rejects.toThrow(/double prompt/);
    expect(fs.existsSync(grantsFile)).toBe(false);
  });

  it('auto-approve ON is unchanged: floor refuses at once, nobody is asked', async () => {
    putSite(entry(), vaultFile, env);
    const h = handlerAnswering({ approved: true, scope: 'always' });
    const m = middleware(h);
    const d = await m.checkPermission('nexus-browser__load_session', { site: 'github.com' },
      { sessionId: 's1', approvalMode: { autoApproveActions: true } } as any);
    expect(d.allowed).toBe(false);
    expect(h.calls).toHaveLength(0);
  });
});

describe("the user's dialog answer is the authority (T3 rev 3, found while grading part A)", () => {
  it("scope 'always' from the dialog writes the standing grant even when the tool call said mode 'once' (a model-chosen argument cannot downgrade the user's choice)", async () => {
    putSite(entry(), vaultFile, env);
    const h = handlerAnswering({ approved: true, scope: 'always' });
    const m = middleware(h);

    await expect(check(m)).resolves.toMatchObject({ allowed: true });
    const cdp = fakeCdp();
    await expect(release(cdp, 'once')).resolves.toEqual({ site: 'github.com', loaded: 1 });
    expect(readGrant('github.com', grantsFile)).toBe('always');

    await expect(check(m)).resolves.toMatchObject({ allowed: true });
    expect(h.calls).toHaveLength(1);
  });

  it("scope 'session' from the dialog: the NEXT load_session call in this process passes the floor without a dialog and releases without asking", async () => {
    putSite(entry(), vaultFile, env);
    const h = handlerAnswering({ approved: true, scope: 'session' });
    const m = middleware(h);

    await expect(check(m)).resolves.toMatchObject({ allowed: true });
    const cdp = fakeCdp();
    await expect(release(cdp, 'once')).resolves.toEqual({ site: 'github.com', loaded: 1 });
    expect(readGrant('github.com', grantsFile)).toBeUndefined();

    await expect(check(m)).resolves.toMatchObject({ allowed: true });
    expect(h.calls).toHaveLength(1);
    const cdp2 = fakeCdp();
    await expect(release(cdp2, 'once')).resolves.toEqual({ site: 'github.com', loaded: 1 });
    expect(cdp2.sent).toHaveLength(1);
  });

  it("a session grant dies with the entry: re-import the site and the floor asks again", async () => {
    putSite(entry(), vaultFile, env);
    const h = handlerAnswering({ approved: true, scope: 'session' });
    const m = middleware(h);
    await check(m);
    await release(fakeCdp(), 'once');

    putSite({ ...entry(), importedAt: 1700000999000 }, vaultFile, env);
    await expect(check(m)).resolves.toMatchObject({ allowed: true });
    expect(h.calls).toHaveLength(2);
  });
});

/**
 * Condition 1 (rev 4): a pre-approval is created ONLY by an interactive dialog answer. Under auto-approve ON and under
 * bypassAll (headless) the floor refuses at once, nobody is asked, and NOTHING is recorded — checked by asking the store
 * afterwards with the exact binding a note would have used.
 */
describe('no pre-approval is ever created without an interactive dialog answer', () => {
  const nothingRecorded = () =>
    expect(takePreApproval({ site: 'github.com', importedAt: 1700000000000, sessionId: 's1' })).toBeUndefined();

  it('auto-approve ON: refused at once, nobody asked, nothing recorded', async () => {
    putSite(entry(), vaultFile, env);
    const h = handlerAnswering({ approved: true, scope: 'always' });
    const m = middleware(h);
    const d = await m.checkPermission('nexus-browser__load_session', { site: 'github.com' },
      { sessionId: 's1', approvalMode: { autoApproveActions: true } } as any);
    expect(d.allowed).toBe(false);
    expect(h.calls).toHaveLength(0);
    nothingRecorded();
  });

  it('bypassAll (headless): refused at once, nobody asked, nothing recorded', async () => {
    putSite(entry(), vaultFile, env);
    const h = handlerAnswering({ approved: true, scope: 'always' });
    const m = new PermissionsMiddleware({
      policies: [loadSessionFloorPolicy({ vaultFile, grantsFile })],
      approvalHandler: h as any,
      bypassAll: true,
    });
    const d = await m.checkPermission('nexus-browser__load_session', { site: 'github.com' },
      { sessionId: 's1', approvalMode: { autoApproveActions: true } } as any);
    expect(d.allowed).toBe(false);
    expect(h.calls).toHaveLength(0);
    nothingRecorded();
  });
});

describe("a 'this session' answer belongs to the session that gave it (D5, cortex-server runs several sessions in one process)", () => {
  const ctx = (sessionId: string) => ({ sessionId, approvalMode: { autoApproveActions: false } }) as any;
  const checkAs = (m: PermissionsMiddleware, sessionId: string) =>
    m.checkPermission('nexus-browser__load_session', { site: 'github.com' }, ctx(sessionId));
  const releaseAs = (cdp: ReturnType<typeof fakeCdp>, sessionId: string, ask: () => never = askThatThrows) => runLoadSession(
    { site: 'github.com', mode: 'once' }, cdp as any,
    { ask: ask as any, vaultFile, logFile, grantsFile, env, sessionId },
  );

  it("session A answers 'this session' => session B is asked (floor dialog), session A is not asked again", async () => {
    putSite(entry(), vaultFile, env);
    const h = handlerAnswering({ approved: true, scope: 'session' });
    const m = middleware(h);

    await checkAs(m, 'A');
    await expect(releaseAs(fakeCdp(), 'A')).resolves.toEqual({ site: 'github.com', loaded: 1 });
    expect(h.calls).toHaveLength(1);

    // A again: the floor passes, nobody is asked
    await checkAs(m, 'A');
    expect(h.calls).toHaveLength(1);

    // B: the floor must ask — A's answer is not B's
    await checkAs(m, 'B');
    expect(h.calls).toHaveLength(2);
  });

  it("session B cannot release on A's session grant even if it skips the floor: the tool's own ask is used", async () => {
    putSite(entry(), vaultFile, env);
    const h = handlerAnswering({ approved: true, scope: 'session' });
    const m = middleware(h);
    await checkAs(m, 'A');
    await releaseAs(fakeCdp(), 'A');

    const asked: string[] = [];
    const cdpB = fakeCdp();
    const askNo = (): never => { asked.push('ask'); return 'no' as never; };
    await expect(releaseAs(cdpB, 'B', askNo)).resolves.toEqual({ site: 'github.com', loaded: 0 });
    expect(asked).toEqual(['ask']);
    expect(cdpB.sent).toHaveLength(0);
  });

  it('no sessionId => a session answer is honoured for that call but never remembered', async () => {
    putSite(entry(), vaultFile, env);
    const cdp = fakeCdp();
    const first = await runLoadSession({ site: 'github.com', mode: 'session' }, cdp as any,
      { ask: (async () => 'session') as any, vaultFile, logFile, grantsFile, env });
    expect(first).toEqual({ site: 'github.com', loaded: 1 });
    const asked: string[] = [];
    await runLoadSession({ site: 'github.com', mode: 'session' }, fakeCdp() as any,
      { ask: (async () => { asked.push('ask'); return 'no'; }) as any, vaultFile, logFile, grantsFile, env });
    expect(asked).toEqual(['ask']);
  });
});
