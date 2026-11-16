/**
 * Saved sign-in WRITE-BACK + EARLY WARNING (operator 11-16: "add them to this release" — a long-running scheduled job, e.g. "scroll my X
 * feed every morning", must not run into a stale snapshot or a silently expired sign-in). Real release path (releaseSite) with a fake
 * CDP session; temp vault/grants/log files; obviously fake values.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { putSite, listSites, getSiteForRelease, refreshSite, type VaultCookie } from './sessionVault.js';
import {
  releaseSite, writeBackLoadedSessions, _resetReleasedForTests, releasedSites, expiryState, noteSessionWarning,
} from './sessionRelease.js';
import { listBrowserSecrets } from './sessionBrowserSecrets.js';

const env = { CORTEX_SECRETS_KEY: 'refresh-test-master' } as NodeJS.ProcessEnv;
const DAY = 86_400;
let dir: string, vaultFile: string, logFile: string, grantsFile: string;
const nowS = () => Math.floor(Date.now() / 1000);
const ck = (over: Partial<VaultCookie> = {}): VaultCookie => ({ name: 'auth_token', value: 'v-old', domain: '.x.com', path: '/', secure: true, httpOnly: true, ...over });

/** A fake CDP session: records setCookies, serves getAllCookies from `jar`. */
function fakeCdp(jar: any[]) {
  const sent: Array<{ method: string; params?: any }> = [];
  return { sent, cdp: { send: async (method: string, params?: any) => { sent.push({ method, params }); return method === 'Network.getAllCookies' ? { cookies: jar } : {}; } } };
}
const opts = () => ({ ask: async () => 'always' as const, vaultFile, logFile, grantsFile, env });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-session-refresh-'));
  vaultFile = path.join(dir, 'session-vault.enc'); logFile = path.join(dir, 'release.jsonl'); grantsFile = path.join(dir, 'grants.json');
  _resetReleasedForTests();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('write-back of refreshed cookies', () => {
  it('stores the browser\'s current cookies for a released site, keeps the import lineage, so the always grant still loads', async () => {
    putSite({ site: 'x.com', cookies: [ck({ expires: nowS() + 300 * DAY })], source: 'chrome:Default', importedAt: 1_700_000_000_000 }, vaultFile, env);
    const a = fakeCdp([]);
    expect((await releaseSite('x.com', 'always', a.cdp, opts())).loaded).toBe(1);
    expect(releasedSites()).toEqual([{ site: 'x.com', importedAt: 1_700_000_000_000 }]);

    // X rotated its tokens while the agent browsed; another site's cookie is in the browser too
    const jar = [
      { name: 'auth_token', value: 'v-new', domain: '.x.com', path: '/', secure: true, httpOnly: true, expires: nowS() + 400 * DAY, session: false, sameSite: 'None' },
      { name: 'ct0', value: 'v-csrf', domain: 'x.com', path: '/', secure: true, httpOnly: false, expires: -1, session: true },
      { name: 'other', value: 'v-other', domain: '.github.com', path: '/', secure: true, httpOnly: true, expires: nowS() + DAY, session: false },
    ];
    const r = await writeBackLoadedSessions(fakeCdp(jar).cdp, { vaultFile, logFile, env, now: () => 1_800_000_000_000 });
    expect(r).toEqual([{ site: 'x.com', saved: 2 }]);
    const e = getSiteForRelease('x.com', vaultFile, env);
    expect(e.importedAt).toBe(1_700_000_000_000);                         // lineage kept
    expect(e.refreshedAt).toBe(1_800_000_000_000);
    expect(e.cookies.map((c) => c.name).sort()).toEqual(['auth_token', 'ct0']);   // github.com's cookie never lands in x.com
    expect(e.cookies.find((c) => c.name === 'auth_token')!.value).toBe('v-new');
    expect(e.cookies.find((c) => c.name === 'ct0')!.expires).toBeUndefined();     // a session cookie keeps no expiry
    expect(listSites(vaultFile)[0]!.expiresAt).toBe(nowS() + 400 * DAY);

    // the standing grant is still valid for the refreshed entry: the next release asks nobody
    let asked = false;
    const again = await releaseSite('x.com', 'once', fakeCdp([]).cdp, { ...opts(), ask: async () => { asked = true; return 'no' as const; } });
    expect(asked).toBe(false); expect(again.loaded).toBe(2);
    const log = fs.readFileSync(logFile, 'utf8');
    expect(log).toMatch(/"mode":"refresh"/); expect(log).not.toMatch(/v-new|v-csrf|v-old/);   // counts only, never a value
  });

  it('never overwrites a NEWER import, and never writes an empty set', async () => {
    putSite({ site: 'x.com', cookies: [ck({ expires: nowS() + 300 * DAY })], source: 'chrome:Default', importedAt: 1 }, vaultFile, env);
    await releaseSite('x.com', 'always', fakeCdp([]).cdp, opts());
    expect((await writeBackLoadedSessions(fakeCdp([]).cdp, { vaultFile, logFile, env }))[0]!.skipped).toMatch(/^signed-out\? /);   // empty jar = every loaded cookie gone
    putSite({ site: 'x.com', cookies: [ck({ value: 'v-reimported', expires: nowS() + 300 * DAY })], source: 'chrome:Default', importedAt: 2 }, vaultFile, env);
    const jar = [{ name: 'auth_token', value: 'v-stale-browser', domain: '.x.com', path: '/', secure: true, httpOnly: true, expires: nowS() + DAY }];
    expect(await writeBackLoadedSessions(fakeCdp(jar).cdp, { vaultFile, logFile, env })).toEqual([{ site: 'x.com', skipped: 'reimported' }]);
    expect(getSiteForRelease('x.com', vaultFile, env).cookies[0]!.value).toBe('v-reimported');
    expect(releasedSites()).toEqual([]);                                     // dropped: never written back again
  });

  it('refreshSite filters to the site\'s own domains and reports counts only', () => {
    putSite({ site: 'github.com', cookies: [ck({ domain: 'github.com' })], source: 's', importedAt: 5 }, vaultFile, env);
    expect(refreshSite('github.com', [ck({ domain: '.evil.com' }), ck({ domain: 'gist.github.com', name: 'g' })], { expectImportedAt: 5, file: vaultFile, env }))
      .toEqual({ site: 'github.com', saved: 1 });
    expect(refreshSite('nope.com', [], { expectImportedAt: 5, file: vaultFile, env })).toEqual({ site: 'nope.com', skipped: 'missing' });
  });
});

describe('early warning', () => {
  it('expiryState: ok / expiring (≤14 d) / expired / unknown', () => {
    const t = 1_800_000_000_000;
    expect(expiryState(t / 1000 + 30 * DAY, t)).toBe('ok');
    expect(expiryState(t / 1000 + 3 * DAY, t)).toBe('expiring');
    expect(expiryState(t / 1000 - 1, t)).toBe('expired');
    expect(expiryState(undefined, t)).toBe('unknown');
  });

  it('a release of an expiring site still loads, returns a warning and notes it once per day; list flags expiringSoon', async () => {
    putSite({ site: 'x.com', cookies: [ck({ expires: nowS() + 3 * DAY })], source: 's', importedAt: 9 }, vaultFile, env);
    const r = await releaseSite('x.com', 'always', fakeCdp([]).cdp, opts());
    expect(r.loaded).toBe(1); expect(r.warning).toMatch(/x\.com expires .* re-import/);
    expect(listBrowserSecrets({ vaultFile, grantsFile }).find((x) => x.site === 'x.com')!.expiringSoon).toBe(true);
    const wf = path.join(dir, 'warnings.jsonl');
    noteSessionWarning('x.com', 'expiring', nowS() + 3 * DAY, Date.now(), wf);
    noteSessionWarning('x.com', 'expiring', nowS() + 3 * DAY, Date.now(), wf);
    expect(fs.readFileSync(wf, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(fs.readFileSync(wf, 'utf8')).not.toMatch(/v-old/);
  });

  it('a fully expired site loads nothing and says to re-import (the scheduled-job failure is no longer silent)', async () => {
    putSite({ site: 'x.com', cookies: [ck({ expires: nowS() - 60 })], source: 's', importedAt: 9 }, vaultFile, env);
    const r = await releaseSite('x.com', 'always', fakeCdp([]).cdp, opts());
    expect(r.loaded).toBe(0); expect(r.warning).toMatch(/has expired — re-import/);
  });
});

describe('signed-out guard', () => {
  it('never writes back when a cookie the site was loaded with is gone from the browser (a logout) — names in the reason, never values', async () => {
    putSite({ site: 'x.com', cookies: [ck({ expires: nowS() + 300 * DAY }), ck({ name: 'ct0', value: 'v-c', expires: nowS() + 300 * DAY })], source: 's', importedAt: 7 }, vaultFile, env);
    expect((await releaseSite('x.com', 'always', fakeCdp([]).cdp, opts())).loaded).toBe(2);
    const jar = [{ name: 'ct0', value: 'v-c2', domain: '.x.com', path: '/', secure: true, httpOnly: false, expires: nowS() + DAY }];   // auth_token deleted
    const r = await writeBackLoadedSessions(fakeCdp(jar).cdp, { vaultFile, logFile, env });
    expect(r[0]!.skipped).toMatch(/signed-out\? 1 loaded cookie\(s\) gone .*auth_token/);
    const wl = fs.readFileSync(path.join(dir, 'session-vault-warnings.jsonl'), 'utf8');
    expect(wl).toMatch(/"kind":"refresh-skipped".*auth_token/); expect(wl).not.toMatch(/v-c2|v-old/);
    expect(JSON.stringify(r)).not.toMatch(/v-c2|v-old/);
    expect(getSiteForRelease('x.com', vaultFile, env).cookies.map((c) => c.value).sort()).toEqual(['v-c', 'v-old']);   // untouched
  });
});
