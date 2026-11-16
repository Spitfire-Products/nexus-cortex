/**
 * Release tickets (vault glue): the harness mints a single-use ticket from the user's answer, the browser process consumes it.
 * Temp vault/grants/ticket dirs with an explicit key; a fake CDP. The last block runs a REAL MCP client + server over the SDK's
 * in-memory transport to prove the ticket travels in the request's _meta and reaches the tool handler.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { putSite } from './sessionVault.js';
import { notePreApproval, clearPreApprovals, clearSessionGrants, hasSessionGrant, readGrantForSite, setGrant } from './sessionRelease.js';
import { mintReleaseTicket, consumeReleaseTicket, prepareLoadSessionCall, RELEASE_TICKET_META, RELEASE_TICKET_TTL_MS } from './sessionTicket.js';
import { runLoadSessionFromCall } from './sessionLoadTool.js';

const env = { CORTEX_SECRETS_KEY: 'ticket-test-master' } as NodeJS.ProcessEnv;
let dir: string; let vaultFile: string; let grantsFile: string; let ticketDir: string; let logFile: string; let importedAt: number;

const cdp = () => { const calls: any[] = []; return { calls, send: async (m: string, p?: any) => { calls.push({ m, p }); return {}; } }; };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-ticket-'));
  vaultFile = path.join(dir, 'vault.enc'); grantsFile = path.join(dir, 'grants.json'); ticketDir = path.join(dir, 'tickets'); logFile = path.join(dir, 'log.jsonl');
  importedAt = 1_800_000_000_000;
  putSite({ site: 'github.com', source: 'chrome:Default', importedAt, cookies: [{ name: 'user_session', value: 'GH-SECRET', domain: '.github.com', path: '/', secure: true, httpOnly: true, expires: 4_000_000_000 }] }, vaultFile, env);
  clearPreApprovals(); clearSessionGrants();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const prep = (sessionId = 'S1', now = Date.now()) => prepareLoadSessionCall({ site: 'github.com' }, sessionId, { vaultFile, grantsFile, ticketDir, now });
const browserSide = (meta: Record<string, unknown> | undefined, c = cdp()) =>
  runLoadSessionFromCall({ site: 'github.com' }, meta, c, { vaultFile, grantsFile, logFile, env, ticketDir });

describe('mint / consume', () => {
  it('one use only; owner-only file; wrong site burns it; malformed ids are refused without touching disk', () => {
    const id = mintReleaseTicket({ site: 'github.com', importedAt, scope: 'once' }, { dir: ticketDir });
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(fs.statSync(path.join(ticketDir, `${id}.json`)).mode & 0o777).toBe(0o600);
    expect(fs.statSync(ticketDir).mode & 0o777).toBe(0o700);
    expect(consumeReleaseTicket(id, 'github.com', { dir: ticketDir })).toMatchObject({ site: 'github.com', importedAt, scope: 'once' });
    expect(consumeReleaseTicket(id, 'github.com', { dir: ticketDir })).toBeUndefined();
    const id2 = mintReleaseTicket({ site: 'github.com', importedAt, scope: 'once' }, { dir: ticketDir });
    expect(consumeReleaseTicket(id2, 'gitlab.com', { dir: ticketDir })).toBeUndefined();
    expect(consumeReleaseTicket(id2, 'github.com', { dir: ticketDir })).toBeUndefined();   // burnt by the mismatch
    for (const bad of ['../../etc/passwd', 'x', 42, undefined, 'A'.repeat(32)]) expect(consumeReleaseTicket(bad, 'github.com', { dir: ticketDir })).toBeUndefined();
    expect(fs.readdirSync(ticketDir)).toEqual([]);
  });
  it('expires after the TTL', () => {
    const t0 = 1_000_000;
    const id = mintReleaseTicket({ site: 'github.com', importedAt, scope: 'once' }, { dir: ticketDir, now: t0 });
    expect(consumeReleaseTicket(id, 'github.com', { dir: ticketDir, now: t0 + RELEASE_TICKET_TTL_MS + 1 })).toBeUndefined();
  });
});

describe('harness side: prepareLoadSessionCall', () => {
  it('no answer held → no ticket (nothing on disk)', () => {
    expect(prep()).toBeUndefined();
    expect(fs.existsSync(ticketDir)).toBe(false);
  });
  it('a dialog answer "once" → one ticket, the pre-approval is consumed (a second prepare gets nothing)', () => {
    notePreApproval({ site: 'github.com', importedAt, sessionId: 'S1', scope: 'once' });
    expect(prep()).toHaveProperty([RELEASE_TICKET_META]);
    expect(prep()).toBeUndefined();
  });
  it('the pre-approval is bound to the session: another session gets nothing', () => {
    notePreApproval({ site: 'github.com', importedAt, sessionId: 'S1', scope: 'once' });
    expect(prep('S2')).toBeUndefined();
  });
  it('"this session" becomes the harness\'s own session grant: every later call in S1 gets a ticket, S2 does not', () => {
    notePreApproval({ site: 'github.com', importedAt, sessionId: 'S1', scope: 'session' });
    expect(prep()).toHaveProperty([RELEASE_TICKET_META]);
    expect(hasSessionGrant('github.com', importedAt, 'S1')).toBe(true);
    expect(prep()).toHaveProperty([RELEASE_TICKET_META]);
    expect(prep('S2')).toBeUndefined();
  });
  it('"always" is written to the grants file for this import and needs no ticket', () => {
    notePreApproval({ site: 'github.com', importedAt, sessionId: 'S1', scope: 'always' });
    expect(prep()).toBeUndefined();
    expect(readGrantForSite('github.com', grantsFile)).toMatchObject({ mode: 'always', importedAt });
  });
  it('a site that is not in the vault → nothing', () => {
    expect(prepareLoadSessionCall({ site: 'nothere.com' }, 'S1', { vaultFile, grantsFile, ticketDir })).toBeUndefined();
    expect(prepareLoadSessionCall({}, 'S1', { vaultFile, grantsFile, ticketDir })).toBeUndefined();
  });
});

describe('browser side: runLoadSessionFromCall', () => {
  it('no ticket and no grant → refused, nothing sent, never asks', async () => {
    const c = cdp();
    const r = await browserSide(undefined, c);
    expect(r).toMatchObject({ site: 'github.com', loaded: 0 });
    expect(r.refused).toMatch(/not approved/);
    expect(c.calls).toEqual([]);
  });
  it('a ticket from the harness releases once; replaying it does not', async () => {
    notePreApproval({ site: 'github.com', importedAt, sessionId: 'S1', scope: 'once' });
    const meta = prep();
    const c = cdp();
    expect(await browserSide(meta, c)).toEqual({ site: 'github.com', loaded: 1 });
    expect(c.calls[0].m).toBe('Network.setCookies');
    expect(JSON.stringify(await browserSide(meta))).toMatch(/"loaded":0.*refused/);
    expect(fs.readFileSync(logFile, 'utf8')).toMatch(/"mode":"once"/);
    expect(fs.readFileSync(logFile, 'utf8')).not.toMatch(/GH-SECRET/);
  });
  it('"always" on disk releases with no ticket (unattended runs)', async () => {
    setGrant('github.com', Date.now(), importedAt, grantsFile);
    expect(await browserSide(undefined)).toEqual({ site: 'github.com', loaded: 1 });
  });
  it('a ticket for an older import is useless after a re-import', async () => {
    notePreApproval({ site: 'github.com', importedAt, sessionId: 'S1', scope: 'once' });
    const meta = prep();
    putSite({ site: 'github.com', source: 'chrome:Default', importedAt: importedAt + 1, cookies: [{ name: 'user_session', value: 'NEW', domain: '.github.com', path: '/', secure: true, httpOnly: true }] }, vaultFile, env);
    expect((await browserSide(meta)).loaded).toBe(0);
  });
  it('the result never carries the ticket id or a value', async () => {
    notePreApproval({ site: 'github.com', importedAt, sessionId: 'S1', scope: 'once' });
    const meta = prep()!;
    const r = await browserSide(meta);
    expect(JSON.stringify(r)).not.toContain(String(meta[RELEASE_TICKET_META]));
    expect(JSON.stringify(r)).not.toMatch(/GH-SECRET/);
  });
});

describe('the ticket travels in MCP _meta (real SDK client + server, in-memory transport)', () => {
  it('the handler receives the id the harness put in _meta; the arguments carry none', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { z } = await import('zod');
    const server = new McpServer({ name: 'nexus-browser', version: 't' });
    const seen: any[] = [];
    server.tool('load_session', 'test', { site: z.string() }, async (args: any, extra: any) => {
      seen.push({ args, meta: extra?._meta });
      return { content: [{ type: 'text', text: JSON.stringify(await runLoadSessionFromCall(args, extra?._meta, cdp(), { vaultFile, grantsFile, logFile, env, ticketDir })) }] };
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'harness', version: 't' });
    await Promise.all([server.connect(a), client.connect(b)]);
    notePreApproval({ site: 'github.com', importedAt, sessionId: 'S1', scope: 'once' });
    const meta = prep();
    const res: any = await client.callTool({ name: 'load_session', arguments: { site: 'github.com' }, _meta: meta });
    expect(JSON.parse(res.content[0].text)).toEqual({ site: 'github.com', loaded: 1 });
    expect(seen[0].args).toEqual({ site: 'github.com' });
    expect(seen[0].meta?.[RELEASE_TICKET_META]).toBe(meta![RELEASE_TICKET_META]);
    await client.close();
  });
});

describe('the orchestrator gate with the REAL permissions middleware + load_session floor', () => {
  const mw = async (answer: any, auto = false) => {
    const { PermissionsMiddleware } = await import('../middleware/PermissionsMiddleware.js');
    const { loadSessionFloorPolicy } = await import('../middleware/permissions/DefaultPolicies.js');
    const calls: any[] = [];
    const m = new PermissionsMiddleware({ policies: [loadSessionFloorPolicy({ vaultFile, grantsFile })], approvalHandler: { requestApproval: async (r: any) => { calls.push(r); return answer; } } as any });
    const ctx = { sessionId: 'S1', approvalMode: { autoApproveActions: auto } } as any;
    return { calls, check: (n: string, i: Record<string, unknown>) => m.checkPermission(n, i, ctx) };
  };
  const gate = async (check: any, raw = 'load_session') => (await import('./sessionTicket.js')).gateMcpLoadSession(raw, `nexus-browser__${raw}`, { site: 'github.com' }, 'S1', check, { vaultFile, grantsFile, ticketDir });

  it('other MCP tools pass through untouched (no check, no meta)', async () => {
    const { calls, check } = await mw(true);
    expect(await gate(check, 'browse')).toBeUndefined();
    expect(calls).toEqual([]);
  });
  it('the user answers "once" in the ONE dialog → a ticket the browser side releases with', async () => {
    const { calls, check } = await mw({ approved: true, scope: 'once' });
    const meta = await gate(check);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'load_session', site: 'github.com' });
    expect(await browserSide(meta)).toEqual({ site: 'github.com', loaded: 1 });
  });
  it('the user says no → refused, nothing forwarded', async () => {
    const { check } = await mw(false);
    await expect(gate(check)).rejects.toThrow(/load_session refused/);
  });
  it('auto-approve with no standing grant → refused without asking', async () => {
    const { calls, check } = await mw(true, true);
    await expect(gate(check)).rejects.toThrow(/load_session refused/);
    expect(calls).toEqual([]);
  });
  it('"this session": the next call in S1 is allowed by the floor without a dialog and still gets a ticket', async () => {
    const { calls, check } = await mw({ approved: true, scope: 'session' });
    await gate(check);
    const meta2 = await gate(check);
    expect(calls).toHaveLength(1);
    expect(await browserSide(meta2)).toEqual({ site: 'github.com', loaded: 1 });
  });
  it('"always": written to disk, later calls skip the dialog and the browser loads with no ticket', async () => {
    const { calls, check } = await mw({ approved: true, scope: 'always' });
    expect(await gate(check)).toBeUndefined();
    expect(await gate(check)).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(await browserSide(undefined)).toEqual({ site: 'github.com', loaded: 1 });
  });
});
