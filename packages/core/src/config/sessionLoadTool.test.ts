/**
 * sessionLoadTool — the load_session tool + the approval-dialog adapter + the FLOOR policy as the middleware runs it (vault T3).
 *
 * Fresh temp dir, explicit env, fake CDP, fake approval handler. Nothing touches ~/.cortex, the keychain or a real browser.
 * Cookie values are obviously fake ('v-0001').
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { putSite, type SiteEntry, type VaultCookie } from './sessionVault.js';
import { clearSessionGrants, readGrant, setGrant, type CdpLike, type ReleaseAnswer } from './sessionRelease.js';
import { loadSessionToolNames, runLoadSession, answerToAsk, askFromApprovalHandler } from './sessionLoadTool.js';
import { PermissionsMiddleware } from '../middleware/PermissionsMiddleware.js';
import { loadSessionFloorPolicy } from '../middleware/permissions/DefaultPolicies.js';

const env = { CORTEX_SECRETS_KEY: 'test-master-1' } as NodeJS.ProcessEnv;
const cookie = (over: Partial<VaultCookie> = {}): VaultCookie => ({
  name: 'session', value: 'v-0001', domain: 'github.com', path: '/', expires: 1800000000,
  secure: true, httpOnly: true, sameSite: 'Lax', ...over,
});
const entry = (over: Partial<SiteEntry> = {}): SiteEntry => ({
  site: 'github.com', cookies: [cookie()], storage: { 'sb-theme': 'v-0002' }, source: 'chrome:Default', importedAt: 1700000000000, ...over,
});

interface FakeCdp extends CdpLike { calls: { method: string; params?: Record<string, unknown> }[] }
const fakeCdp = (): FakeCdp => {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  return { calls, async send(method, params) { calls.push(params === undefined ? { method } : { method, params }); return {}; } };
};

/** An ask that records the prompt and can be told to FAIL the test if it is ever called. */
const stubAsk = (answer: ReleaseAnswer | 'never') => {
  const prompts: string[] = [];
  const ask = (prompt: string) => { prompts.push(prompt); if (answer === 'never') throw new Error('ask must not be called'); return answer as ReleaseAnswer; };
  return { ask, prompts };
};

let dir: string, vaultFile: string, logFile: string, grantsFile: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-load-session-'));
  vaultFile = path.join(dir, 'session-vault.enc');
  logFile = path.join(dir, 'session-vault-release.jsonl');
  grantsFile = path.join(dir, 'session-vault-grants.json');
  clearSessionGrants();
});
afterEach(() => { clearSessionGrants(); fs.rmSync(dir, { recursive: true, force: true }); });

const opts = (ask: ReturnType<typeof stubAsk>['ask']) => ({ ask, vaultFile, logFile, grantsFile, env, now: () => 1700000001000 });
const logLines = (): unknown[] =>
  fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

/** The floor as the MIDDLEWARE runs it — the spec's real success criterion, not just the policy function. */
const middleware = () => new PermissionsMiddleware({ policies: [loadSessionFloorPolicy({ vaultFile, grantsFile })], bypassAll: false });
const check = (mw: PermissionsMiddleware, site: string, autoApproveActions: boolean) =>
  mw.checkPermission('nexus-browser__load_session', { site }, { sessionId: 's1', approvalMode: { autoApproveActions } } as any);

describe('tool names', () => {
  it('answers to the qualified and the bare name', () => {
    expect([...loadSessionToolNames]).toEqual(['nexus-browser__load_session', 'load_session']);
  });
});

describe('runLoadSession argument validation', () => {
  it('requires a string site', async () => {
    await expect(runLoadSession({ site: 42 as unknown as string }, fakeCdp(), opts(stubAsk('once').ask))).rejects.toThrow(/site/i);
  });
  it('defaults mode to once and refuses an unknown mode', async () => {
    putSite(entry(), vaultFile, env);
    await expect(runLoadSession({ site: 'github.com', mode: 'sometimes' as any }, fakeCdp(), opts(stubAsk('once').ask))).rejects.toThrow(/mode/i);
    const cdp = fakeCdp();
    const res = await runLoadSession({ site: 'github.com' }, cdp, opts(stubAsk('once').ask));
    expect(res).toEqual({ site: 'github.com', loaded: 1 });
  });
  it('returns only site/loaded (never a value), plus expired only when > 0', async () => {
    putSite(entry(), vaultFile, env);
    const res = await runLoadSession({ site: 'github.com' }, fakeCdp(), opts(stubAsk('once').ask));
    expect(Object.keys(res).sort()).toEqual(['loaded', 'site']);
    expect(JSON.stringify(res)).not.toContain('v-0001');
  });
});

describe('askFromApprovalHandler', () => {
  it('maps every dialog answer to the 4-way ask', () => {
    expect(answerToAsk(true)).toBe('once');
    expect(answerToAsk(false)).toBe('no');
    expect(answerToAsk('once')).toBe('once');
    expect(answerToAsk('session')).toBe('session');
    expect(answerToAsk('always')).toBe('always');
    expect(answerToAsk('no')).toBe('no');
    expect(answerToAsk({ approved: true })).toBe('once');
    expect(answerToAsk({ approved: true, rememberSession: true })).toBe('session');
    expect(answerToAsk({ approved: true, scope: 'always' })).toBe('always');
    expect(answerToAsk({ approved: false, remember: true })).toBe('no');
    expect(answerToAsk('nonsense' as any)).toBe('no');
  });
  it('drives a fake handler and passes the prompt through as the reason', async () => {
    const seen: string[] = [];
    const ask = askFromApprovalHandler((req) => { seen.push(req.reason); return { approved: true, scope: 'session' }; });
    await expect(ask('Use your saved github.com session?', ['once', 'session', 'always', 'no'])).resolves.toBe('session');
    expect(seen[0]).toContain('github.com');
  });
});

describe('floor policy through PermissionsMiddleware', () => {
  it('auto-approve ON + no grant → refused at once, ask never called, nothing set', async () => {
    putSite(entry(), vaultFile, env);
    const d = await check(middleware(), 'github.com', true);
    expect(d.allowed).toBe(false);
    expect(String((d as { reason?: string }).reason)).toContain('no standing grant for github.com - the user grants it once in the TUI');
    // the refusal is the middleware's: no grant was written and no release was logged
    expect(fs.existsSync(grantsFile)).toBe(false);
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('headless (bypassAll) + no grant → refused at once, nothing set', async () => {
    putSite(entry(), vaultFile, env);
    const mw = new PermissionsMiddleware({ policies: [loadSessionFloorPolicy({ vaultFile, grantsFile })], bypassAll: true });
    const d = await mw.checkPermission('nexus-browser__load_session', { site: 'github.com' }, { sessionId: 's1' } as any);
    expect(d.allowed).toBe(false);
    expect(String((d as { reason?: string }).reason)).toContain('no standing grant for github.com');
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('auto-approve ON + valid always grant → allowed, then released without asking', async () => {
    putSite(entry(), vaultFile, env);
    setGrant('github.com', 1700000000000, 1700000000000, grantsFile);
    const d = await check(middleware(), 'github.com', true);
    expect(d.allowed).toBe(true);
    const { ask, prompts } = stubAsk('never');
    const cdp = fakeCdp();
    const res = await runLoadSession({ site: 'github.com' }, cdp, opts(ask));
    expect(res).toEqual({ site: 'github.com', loaded: 1 });
    expect(prompts).toEqual([]);
    expect(cdp.calls.map((c) => c.method)).toEqual(['Network.setCookies']);
  });

  it('a stale grant (different importedAt) is not a standing grant', async () => {
    putSite(entry(), vaultFile, env);
    setGrant('github.com', 1, 1600000000000, grantsFile); // different entry
    const d = await check(middleware(), 'github.com', true);
    expect(d.allowed).toBe(false);
  });

  it('a site that is not in the vault is allowed (release loads 0, asks nothing)', async () => {
    const d = await check(middleware(), 'example.org', true);
    expect(d.allowed).toBe(true);
    const { ask, prompts } = stubAsk('never');
    await expect(runLoadSession({ site: 'example.org' }, fakeCdp(), opts(ask))).resolves.toEqual({ site: 'example.org', loaded: 0 });
    expect(prompts).toEqual([]);
  });
});

describe('the four answers, end to end through the tool', () => {
  it('interactive yes(once): cookies set + logged + NO grant written', async () => {
    putSite(entry(), vaultFile, env);
    const { ask, prompts } = stubAsk('once');
    const cdp = fakeCdp();
    const res = await runLoadSession({ site: 'github.com' }, cdp, opts(ask));
    expect(res).toEqual({ site: 'github.com', loaded: 1 });
    expect(prompts.length).toBe(1);
    expect(logLines()).toEqual([{ site: 'github.com', mode: 'once', at: 1700000001000 }]);
    expect(fs.existsSync(grantsFile)).toBe(false);
    expect(readGrant('github.com', grantsFile)).toBeUndefined();
  });

  it('always is persisted and honoured without a second ask', async () => {
    putSite(entry(), vaultFile, env);
    const cdp1 = fakeCdp();
    // 'always' is only persisted when the CALLER asks for it (mode: 'always'): an answer can narrow a request, never widen it.
    await runLoadSession({ site: 'github.com', mode: 'always' }, cdp1, opts(stubAsk('always').ask));
    expect(readGrant('github.com', grantsFile)).toBe('always');
    const cdp2 = fakeCdp();
    const { ask, prompts } = stubAsk('never');
    await runLoadSession({ site: 'github.com' }, cdp2, opts(ask));
    expect(prompts).toEqual([]);
    expect(cdp2.calls.length).toBe(1);
  });

  it('no: nothing set, nothing logged, no grant', async () => {
    putSite(entry(), vaultFile, env);
    const cdp = fakeCdp();
    const res = await runLoadSession({ site: 'github.com' }, cdp, opts(stubAsk('no').ask));
    expect(res).toEqual({ site: 'github.com', loaded: 0 });
    expect(cdp.calls).toEqual([]);
    expect(fs.existsSync(grantsFile)).toBe(false);
  });
});

describe('no value escapes', () => {
  it('no cookie value in the result, the log, or a thrown error', async () => {
    putSite(entry({ cookies: [cookie({ value: 'v-0042' })] }), vaultFile, env);
    const res = await runLoadSession({ site: 'github.com' }, fakeCdp(), opts(stubAsk('once').ask));
    expect(JSON.stringify(res)).not.toContain('v-0042');
    expect(fs.readFileSync(logFile, 'utf8')).not.toContain('v-0042');
    const failing: CdpLike = { async send() { throw new Error('rejected v-0042'); } };
    await expect(runLoadSession({ site: 'github.com' }, failing, opts(stubAsk('once').ask))).rejects.toThrow(/could not release/);
    await runLoadSession({ site: 'github.com' }, failing, opts(stubAsk('once').ask)).catch((e: Error) => {
      expect(e.message).not.toContain('v-0042');
    });
  });
});
