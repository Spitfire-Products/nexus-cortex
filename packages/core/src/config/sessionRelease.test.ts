/**
 * sessionRelease — releasing a vaulted browser session into a live page (plan: vault task T2).
 *
 * Every test runs in a fresh temp dir with an EXPLICIT env object and explicit file paths: nothing here touches the real
 * ~/.cortex, the real keychain, the real vault or a real browser. `cdp` is a fake recording object and `ask` a stub.
 * All cookie values are obviously fake ('v-0001').
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { putSite, listSites, revokeSite, getSiteForRelease, SESSION_VAULT_KEY_ID, type SiteEntry, type VaultCookie } from './sessionVault.js';
import { deriveKey, encryptValue, decryptValue, type EncryptedSecret } from './secretsVault.js';
import {
  releaseSite, revokeSessionSite, isPublicSuffix, PUBLIC_SUFFIXES, grantsPath, toCdpPartitionKey, readGrant, setGrant,
  clearSessionGrants, type CdpLike, type ReleaseAnswer, type ReleaseOptions, type Ask,
} from './sessionRelease.js';

const MASTER = 'test-master-1';
const env = { CORTEX_SECRETS_KEY: MASTER } as NodeJS.ProcessEnv;

const cookie = (over: Partial<VaultCookie> = {}): VaultCookie => ({
  name: 'session', value: 'v-0001', domain: 'github.com', path: '/', expires: 1800000000,
  secure: true, httpOnly: true, sameSite: 'Lax', ...over,
});

const entry = (over: Partial<SiteEntry> = {}): SiteEntry => ({
  site: 'github.com',
  cookies: [cookie()],
  storage: { 'sb-theme': 'v-0002' },
  source: 'chrome:Default',
  importedAt: 1700000000000,
  ...over,
});

/** A fake CDP session: records every (method, params) and can be told to fail. */
interface FakeCdp extends CdpLike { calls: { method: string; params?: Record<string, unknown> }[] }
const fakeCdp = (failWith?: string): FakeCdp => {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  return {
    calls,
    async send(method: string, params?: Record<string, unknown>) {
      calls.push(params === undefined ? { method } : { method, params });
      if (failWith) throw new Error(failWith);
      return {};
    },
  };
};

/** A stub approval callback: records the prompt and answers with a fixed value. */
const stubAsk = (answer: ReleaseAnswer) => {
  const prompts: string[] = [];
  const ask = (prompt: string) => { prompts.push(prompt); return answer; };
  return { ask, prompts };
};

let dir: string;
let vaultFile: string;
let logFile: string;
let grantsFile: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-session-release-'));
  vaultFile = path.join(dir, 'session-vault.enc');
  logFile = path.join(dir, 'session-vault-release.jsonl');
  grantsFile = path.join(dir, 'session-vault-grants.json');
  clearSessionGrants();
});
afterEach(() => {
  clearSessionGrants();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The one call shape every release path uses. */
const opts = (ask: Ask, over: Partial<ReleaseOptions> = {}): ReleaseOptions => ({
  ask, vaultFile, logFile, grantsFile, env, now: () => 1700000001000, ...over,
});

const logLines = (): unknown[] =>
  fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

describe('defaults', () => {
  it('the grants file lives beside the vault, under the global config dir', () => {
    expect(grantsPath()).toMatch(/\.cortex[/\\]session-vault-grants\.json$/);
  });
});

describe('no vault entry', () => {
  it('does not ask, does not touch the browser, does not log', async () => {
    const cdp = fakeCdp();
    const { ask, prompts } = stubAsk('once');
    const res = await releaseSite('github.com', 'once', cdp, opts(ask));
    expect(res).toEqual({ site: 'github.com', loaded: 0 });
    expect(prompts).toEqual([]);
    expect(cdp.calls).toEqual([]);
    expect(fs.existsSync(logFile)).toBe(false);
    expect(fs.existsSync(grantsFile)).toBe(false);
  });
});

describe('ask = no', () => {
  it('sets nothing and logs nothing', async () => {
    putSite(entry(), vaultFile, env);
    const cdp = fakeCdp();
    const { ask, prompts } = stubAsk('no');
    const res = await releaseSite('github.com', 'once', cdp, opts(ask));
    expect(res).toEqual({ site: 'github.com', loaded: 0 });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('github.com');
    expect(prompts[0]).toMatch(/once/);
    expect(prompts[0]).toMatch(/session/);
    expect(prompts[0]).toMatch(/always/);
    expect(cdp.calls).toEqual([]);
    expect(logLines()).toEqual([]);
    expect(fs.existsSync(grantsFile)).toBe(false);
  });
});

describe('ask = once', () => {
  it('sets exactly the stored cookie fields, logs the release, returns no values', async () => {
    putSite(entry(), vaultFile, env);
    const cdp = fakeCdp();
    const { ask } = stubAsk('once');
    const res = await releaseSite('github.com', 'once', cdp, opts(ask));
    expect(cdp.calls).toEqual([{
      method: 'Network.setCookies',
      params: { cookies: [{ name: 'session', value: 'v-0001', domain: 'github.com', path: '/', expires: 1800000000, secure: true, httpOnly: true, sameSite: 'Lax' }] },
    }]);
    expect(res).toEqual({ site: 'github.com', loaded: 1 });
    expect(Object.keys(res).sort()).toEqual(['loaded', 'site']);
    expect(JSON.stringify(res)).not.toContain('v-0001');
    expect(logLines()).toEqual([{ site: 'github.com', mode: 'once', at: 1700000001000 }]);
    expect(fs.existsSync(grantsFile)).toBe(false);                    // 'once' is never remembered
  });

  it('maps partitionKey to the CDP shape and omits fields the vault did not have', async () => {
    putSite(entry({ cookies: [cookie({ partitionKey: 'v-0007' }), cookie({ name: 'bare', value: 'v-0008', expires: undefined, sameSite: undefined })] }), vaultFile, env);
    const cdp = fakeCdp();
    await releaseSite('github.com', 'once', cdp, opts(stubAsk('once').ask));
    const cookies = (cdp.calls[0]!.params as { cookies: Record<string, unknown>[] }).cookies;
    expect(cookies[0]).toEqual({ name: 'session', value: 'v-0001', domain: 'github.com', path: '/', expires: 1800000000, secure: true, httpOnly: true, sameSite: 'Lax', partitionKey: { topLevelSite: 'v-0007', hasCrossSiteAncestor: false } });
    expect(Object.keys(cookies[1]!).sort()).toEqual(['domain', 'httpOnly', 'name', 'path', 'secure', 'value']);
  });

  it('does not ask again for a second site when each is a fresh ask', async () => {
    putSite(entry(), vaultFile, env);
    putSite(entry({ site: 'example.org', cookies: [cookie({ domain: 'example.org', value: 'v-0003' })] }), vaultFile, env);
    const cdp = fakeCdp();
    const { ask, prompts } = stubAsk('once');
    await releaseSite('github.com', 'once', cdp, opts(ask));
    await releaseSite('example.org', 'once', cdp, opts(ask));
    expect(prompts).toHaveLength(2);                                  // 'once' never becomes a standing grant
    expect(cdp.calls).toHaveLength(2);
  });
});

describe('ask = session', () => {
  it('is remembered in memory only — never on disk, and the second release does not ask', async () => {
    putSite(entry(), vaultFile, env);
    const cdp = fakeCdp();
    const { ask, prompts } = stubAsk('session');
    await releaseSite('github.com', 'session', cdp, opts(ask, { sessionId: 's1' }));
    await releaseSite('github.com', 'session', cdp, opts(ask, { sessionId: 's1' }));
    expect(prompts).toHaveLength(1);
    expect(cdp.calls).toHaveLength(2);
    expect(fs.existsSync(grantsFile)).toBe(false);
    expect(logLines()).toEqual([
      { site: 'github.com', mode: 'session', at: 1700000001000 },
      { site: 'github.com', mode: 'session', at: 1700000001000 },
    ]);
    clearSessionGrants();                                             // a new process asks again
    await releaseSite('github.com', 'session', cdp, opts(ask, { sessionId: 's1' }));
    expect(prompts).toHaveLength(2);
  });

  it("is bound to the session that answered: another session (or none) asks again; a re-import and a revoke drop it (D5)", async () => {
    putSite(entry(), vaultFile, env);
    const cdp = fakeCdp();
    const { ask, prompts } = stubAsk('session');
    await releaseSite('github.com', 'session', cdp, opts(ask, { sessionId: 'A' }));
    await releaseSite('github.com', 'session', cdp, opts(ask, { sessionId: 'A' }));
    expect(prompts).toHaveLength(1);
    await releaseSite('github.com', 'session', cdp, opts(ask, { sessionId: 'B' }));
    expect(prompts).toHaveLength(2);
    await releaseSite('github.com', 'session', cdp, opts(ask));
    expect(prompts).toHaveLength(3);
    putSite({ ...entry(), importedAt: 1700000999000 }, vaultFile, env);
    await releaseSite('github.com', 'session', cdp, opts(ask, { sessionId: 'A' }));
    expect(prompts).toHaveLength(4);
    await releaseSite('github.com', 'session', cdp, opts(ask, { sessionId: 'A' }));
    expect(prompts).toHaveLength(4);
  });
});

describe('ask = always', () => {
  it('persists the grant (0600, atomically) and honours it without asking next time', async () => {
    putSite(entry(), vaultFile, env);
    const cdp = fakeCdp();
    const first = stubAsk('always');
    await releaseSite('github.com', 'always', cdp, opts(first.ask));
    expect(first.prompts).toHaveLength(1);
    expect((fs.statSync(grantsFile).mode & 0o777).toString(8)).toBe('600');
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]);   // tmp + rename left nothing behind
    expect(JSON.parse(fs.readFileSync(grantsFile, 'utf8')).grants['github.com'].mode).toBe('always');

    clearSessionGrants();                                             // a NEW process: only the file can remember
    const second = stubAsk('no');
    const res = await releaseSite('github.com', 'always', cdp, opts(second.ask));
    expect(second.prompts).toEqual([]);                               // honoured without asking
    expect(res).toEqual({ site: 'github.com', loaded: 1 });
    expect(cdp.calls).toHaveLength(2);
  });

  it('a grant for one site does not release another site', async () => {
    putSite(entry(), vaultFile, env);
    putSite(entry({ site: 'example.org', cookies: [cookie({ domain: 'example.org', value: 'v-0003' })] }), vaultFile, env);
    const cdp = fakeCdp();
    await releaseSite('github.com', 'always', cdp, opts(stubAsk('always').ask));
    clearSessionGrants();
    const other = stubAsk('no');
    const res = await releaseSite('example.org', 'always', cdp, opts(other.ask));
    expect(other.prompts).toHaveLength(1);
    expect(res).toEqual({ site: 'example.org', loaded: 0 });
    expect(cdp.calls).toHaveLength(1);
  });
});

describe('a grant is bound to the vault entry it was given for', () => {
  it('stores the entry importedAt in the always-grant and honours it while the entry is unchanged', async () => {
    putSite(entry(), vaultFile, env);
    const cdp = fakeCdp();
    await releaseSite('github.com', 'always', cdp, opts(stubAsk('always').ask));
    expect(JSON.parse(fs.readFileSync(grantsFile, 'utf8')).grants['github.com'])
      .toEqual({ mode: 'always', at: 1700000001000, importedAt: 1700000000000 });

    clearSessionGrants();                                             // a NEW process: only the file can remember
    const again = stubAsk('no');
    expect(await releaseSite('github.com', 'always', cdp, opts(again.ask))).toEqual({ site: 'github.com', loaded: 1 });
    expect(again.prompts).toEqual([]);                                // same entry: honoured, no question
    expect(cdp.calls).toHaveLength(2);
  });

  it('asks again after the store revokes and re-imports the same site (new importedAt)', async () => {
    putSite(entry(), vaultFile, env);
    const cdp = fakeCdp();
    await releaseSite('github.com', 'always', cdp, opts(stubAsk('always').ask));
    expect(revokeSite('github.com', vaultFile)).toBe(true);           // the STORE's revoke — the grant survives on disk
    putSite(entry({ importedAt: 1700000009000 }), vaultFile, env);    // a different import of the same site

    clearSessionGrants();
    const after = stubAsk('no');
    const res = await releaseSite('github.com', 'always', cdp, opts(after.ask));
    expect(after.prompts).toHaveLength(1);                            // asked again, not released silently
    expect(res).toEqual({ site: 'github.com', loaded: 0 });
    expect(cdp.calls).toHaveLength(1);
  });

  it('a fresh answer overwrites the stale grant with the new importedAt', async () => {
    putSite(entry(), vaultFile, env);
    const cdp = fakeCdp();
    await releaseSite('github.com', 'always', cdp, opts(stubAsk('always').ask));
    revokeSite('github.com', vaultFile);
    putSite(entry({ importedAt: 1700000009000 }), vaultFile, env);

    clearSessionGrants();
    const res = await releaseSite('github.com', 'always', cdp, opts(stubAsk('always').ask));
    expect(res).toEqual({ site: 'github.com', loaded: 1 });
    expect(JSON.parse(fs.readFileSync(grantsFile, 'utf8')).grants['github.com'])
      .toEqual({ mode: 'always', at: 1700000001000, importedAt: 1700000009000 });

    clearSessionGrants();
    const again = stubAsk('no');
    expect(await releaseSite('github.com', 'always', cdp, opts(again.ask))).toEqual({ site: 'github.com', loaded: 1 });
    expect(again.prompts).toEqual([]);                                // the rewritten grant is honoured
  });

  it('asks again for a stale in-memory session grant', async () => {
    putSite(entry(), vaultFile, env);
    const cdp = fakeCdp();
    const { ask, prompts } = stubAsk('session');
    await releaseSite('github.com', 'session', cdp, opts(ask));
    expect(prompts).toHaveLength(1);

    revokeSite('github.com', vaultFile);
    putSite(entry({ importedAt: 1700000009000 }), vaultFile, env);
    const res = await releaseSite('github.com', 'session', cdp, opts(ask));
    expect(prompts).toHaveLength(2);                                  // the memory grant did not carry over
    expect(res).toEqual({ site: 'github.com', loaded: 1 });
    expect(cdp.calls).toHaveLength(2);
  });

  it('asks again for an old-shape grant that has no importedAt', async () => {
    putSite(entry(), vaultFile, env);
    fs.writeFileSync(grantsFile, JSON.stringify({ version: 1, grants: { 'github.com': { mode: 'always', at: 1600000000000 } } }));
    clearSessionGrants();
    const cdp = fakeCdp();
    const after = stubAsk('no');
    const res = await releaseSite('github.com', 'always', cdp, opts(after.ask));
    expect(after.prompts).toHaveLength(1);
    expect(res).toEqual({ site: 'github.com', loaded: 0 });
    expect(cdp.calls).toEqual([]);
  });
});

describe('a stale always-grant can never release anything', () => {
  it('a site revoked through the store is not released by its leftover grant', async () => {
    putSite(entry(), vaultFile, env);
    const cdp = fakeCdp();
    await releaseSite('github.com', 'always', cdp, opts(stubAsk('always').ask));
    expect(cdp.calls).toHaveLength(1);
    expect(revokeSite('github.com', vaultFile)).toBe(true);           // the STORE's revoke, straight — the grant is untouched

    clearSessionGrants();
    const after = stubAsk('once');
    const res = await releaseSite('github.com', 'always', cdp, opts(after.ask));
    expect(res).toEqual({ site: 'github.com', loaded: 0 });
    expect(cdp.calls).toHaveLength(1);                                // nothing was set
    expect(after.prompts).toEqual([]);                                // the vault is checked before any prompt
    expect(listSites(vaultFile)).toEqual([]);
  });
});

describe('revokeSessionSite', () => {
  it('removes the vault entry AND the grant', async () => {
    putSite(entry(), vaultFile, env);
    const cdp = fakeCdp();
    await releaseSite('github.com', 'always', cdp, opts(stubAsk('always').ask));
    const out = await revokeSessionSite('github.com', { vaultFile, grantsFile });
    expect(out).toEqual({ site: 'github.com', revoked: true, grantCleared: true });
    expect(listSites(vaultFile)).toEqual([]);
    expect(JSON.parse(fs.readFileSync(grantsFile, 'utf8')).grants['github.com']).toBeUndefined();

    clearSessionGrants();
    const ask = stubAsk('once');
    const res = await releaseSite('github.com', 'always', cdp, opts(ask.ask));
    expect(res).toEqual({ site: 'github.com', loaded: 0 });
    expect(cdp.calls).toHaveLength(1);
    expect(ask.prompts).toEqual([]);
  });

  it('reports a site that was not there', async () => {
    expect(await revokeSessionSite('github.com', { vaultFile, grantsFile })).toEqual({ site: 'github.com', revoked: false, grantCleared: false });
  });
});

describe('public-suffix guard (PARTIAL vendored list)', () => {
  it('refuses public suffixes', async () => {
    for (const s of ['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'co.jp', 'github.io', 'gitlab.io', 'herokuapp.com', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'blogspot.com', 'appspot.com', 'cloudfront.net', 'amazonaws.com', 'com.br']) {
      expect(isPublicSuffix(s)).toBe(true);
      const cdp = fakeCdp();
      const { ask, prompts } = stubAsk('always');
      await expect(releaseSite(s, 'always', cdp, opts(ask))).rejects.toThrow(/public suffix/i);
      expect(prompts).toEqual([]);
      expect(cdp.calls).toEqual([]);
      expect(fs.existsSync(grantsFile)).toBe(false);
    }
  });

  it('accepts registrable domains, including under a multi-part suffix', async () => {
    for (const s of ['github.com', 'example.co.uk', 'example.org.uk', 'example.com.au', 'example.co.jp', 'example.github.io']) {
      expect(isPublicSuffix(s)).toBe(false);
    }
    expect(PUBLIC_SUFFIXES).toContain('co.uk');
    expect(PUBLIC_SUFFIXES).not.toContain('github.com');
  });
});

describe('a cookie value never leaks', () => {
  it('not into the returned object, not into the log, not into a thrown error', async () => {
    putSite(entry(), vaultFile, env);
    const { ask } = stubAsk('once');
    const res = await releaseSite('github.com', 'once', fakeCdp(), opts(ask));
    expect(JSON.stringify(res)).not.toContain('v-0001');
    expect(fs.readFileSync(logFile, 'utf8')).not.toContain('v-0001');
    expect(fs.readFileSync(logFile, 'utf8')).not.toContain('v-0002');

    const cdp = fakeCdp('Network.setCookies rejected CookieParam.value=v-0001 for github.com');
    let thrown: unknown;
    try { await releaseSite('github.com', 'once', cdp, opts(stubAsk('once').ask)); }
    catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(Error);
    const msg = (thrown as Error).message;
    expect(msg).toMatch(/could not release/i);
    expect(msg).not.toContain('v-0001');
    expect(msg).not.toContain('CookieParam');
    expect(JSON.stringify(Object.entries(thrown as Error))).not.toContain('v-0001');
  });

  it('a failed set leaves the attempt on record — and never a value', async () => {
    putSite(entry(), vaultFile, env);
    await expect(releaseSite('github.com', 'once', fakeCdp('boom v-0001'), opts(stubAsk('once').ask))).rejects.toThrow(/could not release/i);
    expect(logLines()).toEqual([{ site: 'github.com', mode: 'once', at: 1700000001000 }]);   // the attempt, not a release
    expect(fs.readFileSync(logFile, 'utf8')).not.toContain('v-0001');
  });
});

describe('fail-closed order: the attempt is logged before the browser is told', () => {
  it('the log line is already on disk when Network.setCookies is called', async () => {
    putSite(entry(), vaultFile, env);
    let linesAtSend: unknown[] | undefined;
    const cdp: CdpLike = {
      async send() { linesAtSend = logLines(); return {}; },
    };
    const res = await releaseSite('github.com', 'once', cdp, opts(stubAsk('once').ask));
    expect(linesAtSend).toEqual([{ site: 'github.com', mode: 'once', at: 1700000001000 }]);
    expect(res).toEqual({ site: 'github.com', loaded: 1 });
  });

  it('a log failure means nothing is sent and the error propagates without a value', async () => {
    putSite(entry(), vaultFile, env);
    const blocker = path.join(dir, 'not-a-dir');
    fs.writeFileSync(blocker, 'x');                                   // a regular file where a directory is needed
    const cdp = fakeCdp();
    let thrown: unknown;
    try {
      await releaseSite('github.com', 'once', cdp, opts(stubAsk('once').ask, { logFile: path.join(blocker, 'release.jsonl') }));
    } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(Error);
    expect(cdp.calls).toEqual([]);                                    // the browser was never told
    expect((thrown as Error).message).not.toContain('v-0001');
  });
});

describe('expired cookies are never sent', () => {
  it('sends only the unexpired ones and loaded is what was actually sent', async () => {
    putSite(entry({
      cookies: [
        cookie({ name: 'old', value: 'v-0001', expires: 1690000000 }),        // long expired
        cookie({ name: 'live', value: 'v-0002', expires: 1800000000 }),
        cookie({ name: 'sess', value: 'v-0003', expires: undefined }),        // session cookie: kept
        cookie({ name: 'zero', value: 'v-0004', expires: 0 }),                // <= 0: kept
      ],
    }), vaultFile, env);
    const cdp = fakeCdp();
    const res = await releaseSite('github.com', 'once', cdp, opts(stubAsk('once').ask));
    const cookies = (cdp.calls[0]!.params as { cookies: { name: string }[] }).cookies;
    expect(cookies.map((c) => c.name)).toEqual(['live', 'sess', 'zero']);
    expect(res).toEqual({ site: 'github.com', loaded: 3 });
    expect(logLines()).toEqual([{ site: 'github.com', mode: 'once', at: 1700000001000 }]);
  });

  it('keeps a cookie whose expiry is exactly now (only expires*1000 < now is dropped)', async () => {
    putSite(entry({ cookies: [
      cookie({ name: 'edge', value: 'v-0005', expires: 1700000001 }),        // *1000 === now: kept
      cookie({ name: 'just-gone', value: 'v-0006', expires: 1700000000 }),   // *1000 < now: dropped
    ] }), vaultFile, env);
    const cdp = fakeCdp();
    const res = await releaseSite('github.com', 'once', cdp, opts(stubAsk('once').ask));
    const cookies = (cdp.calls[0]!.params as { cookies: { name: string }[] }).cookies;
    expect(cookies.map((c) => c.name)).toEqual(['edge']);
    expect(res).toMatchObject({ site: 'github.com', loaded: 1 });   // + an early warning: the only cookie expires now (11-16)
    expect(res.warning).toMatch(/expires .* re-import/);
  });

  it('every cookie expired: no ask, nothing sent, nothing logged, loaded 0', async () => {
    putSite(entry({ cookies: [cookie({ name: 'a', value: 'v-0007', expires: 1600000000 }), cookie({ name: 'b', value: 'v-0008', expires: 1500000000 })] }), vaultFile, env);
    const cdp = fakeCdp();
    const { ask, prompts } = stubAsk('once');
    const res = await releaseSite('github.com', 'once', cdp, opts(ask));
    expect(res).toEqual({ site: 'github.com', loaded: 0, expired: 2, warning: expect.stringMatching(/has expired — re-import/) });
    expect(prompts).toEqual([]);
    expect(cdp.calls).toEqual([]);
    expect(logLines()).toEqual([]);
  });
});

describe('T3: partitionKey conversion', () => {
  it('none → undefined, string (legacy) → false, object → kept exactly as stored, anything else → invalid', () => {
    expect(toCdpPartitionKey(undefined)).toBeUndefined();
    expect(toCdpPartitionKey(null)).toBeUndefined();
    // the bare string is the LEGACY / unknown form: has_cross_site_ancestor was never recorded, so it cannot be claimed true
    expect(toCdpPartitionKey('https://github.com')).toEqual({ topLevelSite: 'https://github.com', hasCrossSiteAncestor: false });
    // the object form is what a browser importer stores: the flag is carried, never forced to false
    expect(toCdpPartitionKey({ topLevelSite: 'https://a.example', hasCrossSiteAncestor: false })).toEqual({ topLevelSite: 'https://a.example', hasCrossSiteAncestor: false });
    expect(toCdpPartitionKey({ topLevelSite: 'https://a.example', hasCrossSiteAncestor: true })).toEqual({ topLevelSite: 'https://a.example', hasCrossSiteAncestor: true });
    expect(toCdpPartitionKey('')).toBeNull();
    expect(toCdpPartitionKey(7)).toBeNull();
    expect(toCdpPartitionKey({})).toBeNull();
    expect(toCdpPartitionKey({ topLevelSite: 7 })).toBeNull();
    // an object without a boolean flag cannot be expressed faithfully → dropped, never guessed as false
    expect(toCdpPartitionKey({ topLevelSite: 'https://a.example' })).toBeNull();
    expect(toCdpPartitionKey({ topLevelSite: 'https://a.example', hasCrossSiteAncestor: 'true' })).toBeNull();
  });

  it('T3 D3: an object partitionKey with hasCrossSiteAncestor true survives the vault and reaches Network.setCookies', async () => {
    const key = { topLevelSite: 'v-0020', hasCrossSiteAncestor: true };
    putSite(entry({ cookies: [cookie({ partitionKey: key })] }), vaultFile, env);
    expect(getSiteForRelease('github.com', vaultFile, env).cookies[0]!.partitionKey).toEqual(key);
    const cdp = fakeCdp();
    const res = await releaseSite('github.com', 'once', cdp, opts(stubAsk('once').ask));
    expect(res).toEqual({ site: 'github.com', loaded: 1 });
    const sent = (cdp.calls[0]!.params as { cookies: Record<string, unknown>[] }).cookies;
    expect(sent[0]!.partitionKey).toEqual({ topLevelSite: 'v-0020', hasCrossSiteAncestor: true });
  });

  it('refuses to STORE an invalid partitionKey (T3 D3: the store validates it now)', () => {
    expect(() => putSite(entry({ cookies: [
      cookie({ name: 'plain', value: 'v-0001' }),
      cookie({ name: 'broken', value: 'v-0003', partitionKey: '' }),
    ] }), vaultFile, env)).toThrow(/partitionKey/i);
    expect(fs.existsSync(vaultFile)).toBe(false);
  });

  it('drops a cookie whose STORED partitionKey cannot be sent, and counts it in skipped', async () => {
    putSite(entry({ cookies: [
      cookie({ name: 'plain', value: 'v-0001' }),
      cookie({ name: 'partitioned', value: 'v-0002', partitionKey: 'https://github.com' }),
      cookie({ name: 'broken', value: 'v-0003' }),
    ] }), vaultFile, env);
    // A payload written by an older build (or a hand-edited vault) is not re-validated on read, so the send-time guard still
    // has to drop a key it cannot express — never send the cookie unpartitioned.
    const stored = JSON.parse(fs.readFileSync(vaultFile, 'utf8')) as { sites: Record<string, { payload: EncryptedSecret }> };
    const key = deriveKey(MASTER, SESSION_VAULT_KEY_ID);
    const rec = stored.sites['github.com']!;
    const payload = JSON.parse(decryptValue(key, rec.payload)) as { cookies: Record<string, unknown>[]; storage: Record<string, string> };
    payload.cookies[2]!.partitionKey = '';
    rec.payload = encryptValue(key, JSON.stringify(payload));
    fs.writeFileSync(vaultFile, JSON.stringify(stored), { mode: 0o600 });

    const cdp = fakeCdp();
    const res = await releaseSite('github.com', 'once', cdp, opts(stubAsk('once').ask));
    expect(res).toEqual({ site: 'github.com', loaded: 2, skipped: 1 });
    const sent = (cdp.calls[0]!.params as { cookies: Record<string, unknown>[] }).cookies;
    expect(sent.map((c) => c.name)).toEqual(['plain', 'partitioned']);
    expect(sent[0]!.partitionKey).toBeUndefined();
    expect(sent[1]!.partitionKey).toEqual({ topLevelSite: 'https://github.com', hasCrossSiteAncestor: false });
  });

  it('omits skipped entirely when nothing was dropped', async () => {
    putSite(entry(), vaultFile, env);
    const res = await releaseSite('github.com', 'once', fakeCdp(), opts(stubAsk('once').ask));
    expect(res).toEqual({ site: 'github.com', loaded: 1 });
  });
});

describe('T3: a stale grant is cleared on ANY answer', () => {
  it('no: the stale grant is gone afterwards', async () => {
    putSite(entry(), vaultFile, env);
    setGrant('github.com', 1700000000000, 1600000000000, grantsFile); // a DIFFERENT entry's grant
    const cdp = fakeCdp();
    const res = await releaseSite('github.com', 'once', cdp, opts(stubAsk('no').ask));
    expect(res).toEqual({ site: 'github.com', loaded: 0 });
    expect(readGrant('github.com', grantsFile)).toBeUndefined();
  });
});

describe('input validation', () => {
  it('refuses a URL-ish site and a non-mode', async () => {
    await expect(releaseSite('github.com/login', 'once', fakeCdp(), opts(stubAsk('once').ask))).rejects.toThrow(/site/i);
    await expect(releaseSite('github.com', 'forever' as never, fakeCdp(), opts(stubAsk('once').ask))).rejects.toThrow(/mode/i);
  });

  it('an unknown answer fails closed (nothing released, nothing logged)', async () => {
    putSite(entry(), vaultFile, env);
    const cdp = fakeCdp();
    const res = await releaseSite('github.com', 'once', cdp, opts((() => 'maybe') as never));
    expect(res).toEqual({ site: 'github.com', loaded: 0 });
    expect(cdp.calls).toEqual([]);
    expect(logLines()).toEqual([]);
  });
});
