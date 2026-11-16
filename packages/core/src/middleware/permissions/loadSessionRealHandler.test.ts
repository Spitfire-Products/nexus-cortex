/**
 * load_session end to end through the REAL CLIApprovalHandler (vault task T3 rev 4, condition 2).
 *
 * PermissionsMiddleware + the real floor policy + the REAL CLIApprovalHandler (fake TTY stdin) + runLoadSession with a fake CDP
 * and the tool's own `ask` set to a stub that THROWS if it is ever reached. The dialog is driven with real keystrokes, and the
 * tool call passes NO mode: the user's answer in the dialog is the authority (rev 3), not a model-chosen argument.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { putSite, type SiteEntry, type VaultCookie } from '../../config/sessionVault.js';
import { clearSessionGrants, clearPreApprovals, readGrantForSite } from '../../config/sessionRelease.js';
import { runLoadSession } from '../../config/sessionLoadTool.js';
import { PermissionsMiddleware } from '../PermissionsMiddleware.js';
import { loadSessionFloorPolicy } from './DefaultPolicies.js';
import { CLIApprovalHandler } from './CLIApprovalHandler.js';

const env = { CORTEX_SECRETS_KEY: 'test-master-1' } as NodeJS.ProcessEnv;
const SITE = 'github.com';
const SID = 's1';
const IMPORTED_AT = 1700000000000;

const cookie = (over: Partial<VaultCookie> = {}): VaultCookie => ({
  name: 'session', value: 'v-0001', domain: SITE, path: '/', expires: 1800000000,
  secure: true, httpOnly: true, sameSite: 'Lax', ...over,
});
const entry = (over: Partial<SiteEntry> = {}): SiteEntry => ({
  site: SITE, cookies: [cookie()], source: 'chrome:Default', importedAt: IMPORTED_AT, ...over,
});

let dir: string, vaultFile: string, grantsFile: string, logFile: string;

// ── the fake TTY (same shape as CLIApprovalHandler.test.ts) ─────────────────
type FakeStdin = PassThrough & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (m: boolean) => void };
let stdin: FakeStdin;
let out: string[];
let realStdin: NodeJS.ReadStream;
let realStdoutWrite: typeof process.stdout.write;
let realLog: typeof console.log;
const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeStdin(): FakeStdin {
  const s = new PassThrough() as any;
  s.isTTY = true;
  s.isRaw = false;
  s.setRawMode = (m: boolean) => { s.isRaw = m; };
  s.pause();
  return s;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-load-session-real-'));
  vaultFile = path.join(dir, 'session-vault.enc');
  grantsFile = path.join(dir, 'session-vault-grants.json');
  logFile = path.join(dir, 'session-release.log');
  clearSessionGrants();
  clearPreApprovals();

  out = [];
  realStdin = process.stdin;
  stdin = fakeStdin();
  Object.defineProperty(process, 'stdin', { value: stdin, configurable: true, writable: true });
  realStdoutWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: any) => { out.push(String(chunk)); return true; };
  realLog = console.log;
  (console as any).log = (...args: any[]) => { out.push(args.map((a) => String(a)).join(' ')); };
});

afterEach(async () => {
  await sleep(20);
  (console as any).log = realLog;
  (process.stdout as any).write = realStdoutWrite;
  Object.defineProperty(process, 'stdin', { value: realStdin, configurable: true, writable: true });
  clearSessionGrants();
  clearPreApprovals();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── the wiring under test ───────────────────────────────────────────────────
const realHandler = () => new CLIApprovalHandler({
  onToggleAutoApprove: () => {},
  getAutoApproveStatus: () => false,
});

const middleware = () => new PermissionsMiddleware({
  policies: [loadSessionFloorPolicy({ vaultFile, grantsFile })],
  approvalHandler: realHandler() as any,
});

const interactive = { sessionId: SID, approvalMode: { autoApproveActions: false } } as any;

const fakeCdp = () => {
  const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  return { sent, send: async (method: string, params?: Record<string, unknown>) => { sent.push({ method, params }); return {}; } };
};

/** The tool's own ask: reaching it would be a SECOND prompt, so it throws. */
const askThatThrows = (): never => { throw new Error('releaseSite asked a second time (double prompt)'); };

/** The tool call, with NO mode: the dialog answer decides. */
const release = (cdp: ReturnType<typeof fakeCdp>, sessionId: string = SID) => runLoadSession(
  { site: SITE }, cdp as any,
  { ask: askThatThrows as any, vaultFile, logFile, grantsFile, env, sessionId },
);

/** Ask the floor and answer its dialog with ONE keystroke ('1' once, '2' session, '3' always, '4' no). */
async function checkWithKey(m: PermissionsMiddleware, key: string) {
  const p = m.checkPermission('nexus-browser__load_session', { site: SITE }, interactive);
  await tick();
  stdin.emit('data', Buffer.from(key));
  return await p;
}

/** Ask the floor expecting NO dialog: if one opens, this resolves 'dialog' instead of hanging. */
async function checkWithoutDialog(m: PermissionsMiddleware) {
  const p = m.checkPermission('nexus-browser__load_session', { site: SITE }, interactive);
  const raced = await Promise.race([p, sleep(400).then(() => 'dialog' as const)]);
  return raced;
}

describe('load_session through the real CLI dialog', () => {
  it("'once' (key 1): cookies set, release logged, no grants file, and the next call asks again", async () => {
    putSite(entry(), vaultFile, env);
    const m = middleware();

    await expect(checkWithKey(m, '1')).resolves.toMatchObject({ allowed: true });

    const cdp = fakeCdp();
    await expect(release(cdp)).resolves.toEqual({ site: SITE, loaded: 1 });
    expect(cdp.sent).toHaveLength(1);
    expect(cdp.sent[0]!.method).toBe('Network.setCookies');
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.existsSync(grantsFile)).toBe(false);

    // Nothing left in memory: the next call asks again (a fresh keystroke is required to pass).
    await expect(checkWithKey(m, '1')).resolves.toMatchObject({ allowed: true });
  });

  it("'this session' (key 2): released, no grants file, the next call passes the floor and releases with no dialog", async () => {
    putSite(entry(), vaultFile, env);
    const m = middleware();

    await expect(checkWithKey(m, '2')).resolves.toMatchObject({ allowed: true });
    const cdp = fakeCdp();
    await expect(release(cdp)).resolves.toEqual({ site: SITE, loaded: 1 });
    expect(cdp.sent).toHaveLength(1);
    expect(fs.existsSync(grantsFile)).toBe(false);

    const again = await checkWithoutDialog(m);
    expect(again).not.toBe('dialog');
    expect(again).toMatchObject({ allowed: true });

    const cdp2 = fakeCdp();
    await expect(release(cdp2)).resolves.toEqual({ site: SITE, loaded: 1 });
    expect(cdp2.sent).toHaveLength(1);
  });

  it("'always' (key 3): grants file written with mode 'always' and THIS entry's importedAt, 0600, next call releases with no dialog", async () => {
    putSite(entry(), vaultFile, env);
    const m = middleware();

    await expect(checkWithKey(m, '3')).resolves.toMatchObject({ allowed: true });
    const cdp = fakeCdp();
    await expect(release(cdp)).resolves.toEqual({ site: SITE, loaded: 1 });
    expect(cdp.sent).toHaveLength(1);

    expect(fs.existsSync(grantsFile)).toBe(true);
    const record = readGrantForSite(SITE, grantsFile);
    expect(record?.mode).toBe('always');
    expect(record?.importedAt).toBe(IMPORTED_AT);
    expect(fs.statSync(grantsFile).mode & 0o777).toBe(0o600);

    const again = await checkWithoutDialog(m);
    expect(again).not.toBe('dialog');
    expect(again).toMatchObject({ allowed: true });
    const cdp2 = fakeCdp();
    await expect(release(cdp2)).resolves.toEqual({ site: SITE, loaded: 1 });
    expect(cdp2.sent).toHaveLength(1);
  });

  it("'no' (key 4): nothing set, nothing logged, no grant", async () => {
    putSite(entry(), vaultFile, env);
    const m = middleware();

    await expect(checkWithKey(m, '4')).resolves.toMatchObject({ allowed: false });
    expect(fs.existsSync(grantsFile)).toBe(false);
    expect(fs.existsSync(logFile)).toBe(false);
    // No pre-approval was recorded: the tool's own ask would be reached, and it throws.
    const cdp = fakeCdp();
    await expect(release(cdp)).rejects.toThrow(/double prompt/);
    expect(cdp.sent).toHaveLength(0);
  });

  it("the dialog's answer is bound to the answering session: a release from ANOTHER sessionId consumes nothing, and does not burn it", async () => {
    putSite(entry(), vaultFile, env);
    const m = middleware();

    await expect(checkWithKey(m, '1')).resolves.toMatchObject({ allowed: true });

    // Another session: the pre-approval does not match, so the tool's own ask is used — and it throws.
    const other = fakeCdp();
    await expect(release(other, 's2')).rejects.toThrow(/double prompt/);
    expect(other.sent).toHaveLength(0);
    expect(fs.existsSync(logFile)).toBe(false);

    // The answering session still gets it: the mismatched take did not consume the user's answer.
    const mine = fakeCdp();
    await expect(release(mine)).resolves.toEqual({ site: SITE, loaded: 1 });
    expect(mine.sent).toHaveLength(1);
  });
});
