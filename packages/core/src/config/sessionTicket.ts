/**
 * sessionTicket — the single-use release TICKET that carries the user's answer from the harness to the browser process
 * (vault glue, operator GO 2026-11-15).
 *
 * Why: the local browser runs as a SEPARATE stdio MCP process. The user's answer to "Use your saved github.com session for this
 * task?" lives in the HARNESS process — the floor's pre-approval (once / this session / always) and the in-memory 'this session'
 * grants — and the browser process can neither see that memory nor ask the user (its stdio is the MCP channel). Without a handoff
 * only an 'always' grant (on disk) could ever load.
 *
 * The handoff: when the harness forwards an approved `load_session` call it mints a ticket — an owner-only file
 * `~/.cortex/session-tickets/<id>.json` holding { site, importedAt, scope, at } — and puts its id in the forwarded MCP request's
 * `_meta` (RELEASE_TICKET_META), outside the tool arguments, so the model never sees one and cannot supply one. The browser process consumes it: claims it with an atomic rename (so two
 * consumers can never both win), deletes it, and accepts it only for the same site and the same vault entry (importedAt) within
 * 30 s. No cookie value ever travels in a ticket; the browser process reads the vault itself, exactly as it does for 'always'.
 *
 * Trust: the same as the grants file next to it — anything that can write under ~/.cortex as this user can already write an 'always'
 * grant. The id is 128 random bits; a ticket is useless after one use or 30 s, and it names one vault entry, so a re-import or a
 * revoke makes it dead.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { listSites, sessionVaultPath } from './sessionVault.js';
import { takePreApproval, hasSessionGrant, addSessionGrant, setGrant, grantsPath, type PreApprovalScope } from './sessionRelease.js';

const getGlobalConfigDir = (): string => path.join(process.env.CORTEX_HOME || os.homedir() || process.cwd(), '.cortex');

export const SESSION_TICKETS_DIR = 'session-tickets';
export const RELEASE_TICKET_TTL_MS = 30_000;
/** Where the harness puts the ticket id: the MCP request's `_meta` (never the tool arguments — the model never sees or supplies it). */
export const RELEASE_TICKET_META = 'nexus-cortex/releaseTicket';
const ID_RE = /^[0-9a-f]{32}$/;

export const ticketsDir = (): string => path.join(getGlobalConfigDir(), SESSION_TICKETS_DIR);

export interface ReleaseTicket { site: string; importedAt: number; scope: PreApprovalScope; at: number }
export interface TicketOptions { dir?: string; now?: number }

function sweep(dir: string, nowMs: number): void {
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) {
    const p = path.join(dir, n);
    try { if (nowMs - fs.statSync(p).mtimeMs > RELEASE_TICKET_TTL_MS * 2) fs.rmSync(p, { force: true }); } catch { /* raced */ }
  }
}

/** Write a ticket for one approved release. Returns its id. */
export function mintReleaseTicket(t: { site: string; importedAt: number; scope: PreApprovalScope }, o: TicketOptions = {}): string {
  const site = String(t?.site ?? '').trim().toLowerCase();
  if (!site) throw new Error('a ticket needs a site');
  if (t.scope !== 'once' && t.scope !== 'session' && t.scope !== 'always') throw new Error(`invalid ticket scope "${String(t.scope)}"`);
  if (typeof t.importedAt !== 'number' || !Number.isFinite(t.importedAt)) throw new Error('a ticket needs the vault entry it is for (importedAt)');
  const dir = o.dir ?? ticketsDir();
  const now = o.now ?? Date.now();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* not ours to fix */ }
  sweep(dir, now);
  const id = crypto.randomBytes(16).toString('hex');
  const body: ReleaseTicket = { site, importedAt: t.importedAt, scope: t.scope, at: now };
  const tmp = path.join(dir, `.${id}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(body), { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, path.join(dir, `${id}.json`));
  return id;
}

/**
 * Consume a ticket for `site`. ONE-SHOT: the file is claimed by an atomic rename, read and deleted, whatever the outcome — a ticket
 * presented for the wrong site is burnt, not kept (a mismatch means something is wrong; the user is asked again next time).
 * Returns the ticket, or undefined when it is missing, malformed, expired, or for another site.
 */
export function consumeReleaseTicket(id: unknown, site: string, o: TicketOptions = {}): ReleaseTicket | undefined {
  if (typeof id !== 'string' || !ID_RE.test(id)) return undefined;
  const dir = o.dir ?? ticketsDir();
  const now = o.now ?? Date.now();
  const src = path.join(dir, `${id}.json`);
  const claimed = path.join(dir, `.${id}.claimed-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try { fs.renameSync(src, claimed); } catch { return undefined; }   // gone, or another consumer won
  let t: ReleaseTicket | undefined;
  try { t = JSON.parse(fs.readFileSync(claimed, 'utf8')) as ReleaseTicket; } catch { t = undefined; }
  finally { fs.rmSync(claimed, { force: true }); }
  if (!t || typeof t !== 'object') return undefined;
  if (t.site !== String(site ?? '').trim().toLowerCase()) return undefined;
  if (t.scope !== 'once' && t.scope !== 'session' && t.scope !== 'always') return undefined;
  if (typeof t.importedAt !== 'number' || typeof t.at !== 'number') return undefined;
  if (now - t.at > RELEASE_TICKET_TTL_MS || t.at - now > 5_000) return undefined;
  return t;
}

/**
 * The orchestrator's gate for one MCP tool call (MCP calls skip the general permission check, so the load_session FLOOR runs here
 * for this one tool). Returns the `_meta` to forward with the call — a release ticket when the user's answer is held — or undefined
 * for every other tool. Throws "load_session refused: …" when the floor (or the user) refuses; the call is then not forwarded.
 * `check` is the permissions middleware bound to this call's context (sessionId, approval mode); without one nothing is asked and no
 * ticket can exist (the browser honours only an 'always' grant).
 */
export async function gateMcpLoadSession(
  rawToolName: string,
  toolName: string,
  input: Record<string, unknown> | undefined,
  sessionId: string | undefined,
  check: ((toolName: string, input: Record<string, unknown>) => Promise<{ allowed: boolean; reason?: string }>) | undefined,
  o: PrepareLoadSessionOptions = {},
): Promise<Record<string, unknown> | undefined> {
  if (rawToolName !== 'load_session') return undefined;
  const args = (input ?? {}) as Record<string, unknown>;
  if (check) {
    const d = await check(toolName, args);
    if (!d.allowed) throw new Error(`load_session refused: ${d.reason || 'not approved'}`);
  }
  return prepareLoadSessionCall(args, sessionId, o);
}

export interface PrepareLoadSessionOptions { vaultFile?: string; grantsFile?: string; ticketDir?: string; now?: number }

/**
 * HARNESS side, called on an approved `load_session` call just before it is forwarded to the browser process. Returns the MCP
 * `_meta` to send with it: a fresh ticket id when this process holds the user's answer for this call, else nothing:
 *   - the floor's dialog answer (the pre-approval, consumed here — one dialog, one release), or
 *   - a 'this session' grant this session holds.
 * The harness also does the grant bookkeeping the in-process releaseSite would have done: a dialog answer of 'session' becomes the
 * harness's own 'this session' grant (so the next call skips the dialog), and 'always' is written to the grants file (the browser
 * process then finds it there and needs no ticket).
 * No answer held (an 'always' grant on disk, or nobody asked) → no ticket: the browser process honours 'always' from disk and
 * refuses everything else. Never throws for a bad call — the browser side reports it.
 */
export function prepareLoadSessionCall(args: Record<string, unknown>, sessionId: string | undefined, o: PrepareLoadSessionOptions = {}): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  const site = typeof args?.site === 'string' ? args.site.trim().toLowerCase() : '';
  if (!site) return undefined;
  let importedAt: number | undefined;
  try { importedAt = listSites(o.vaultFile ?? sessionVaultPath()).find((x) => x.site === site)?.importedAt; } catch { return undefined; }
  if (importedAt === undefined) return undefined;
  const now = o.now ?? Date.now();
  let scope: PreApprovalScope | undefined = takePreApproval({ site, importedAt, ...(sessionId !== undefined ? { sessionId } : {}), now });
  if (scope === 'session') addSessionGrant(site, importedAt, sessionId);
  else if (scope === 'always') { setGrant(site, now, importedAt, o.grantsFile ?? grantsPath()); scope = undefined; }   // on disk now: no ticket needed
  if (scope === undefined && hasSessionGrant(site, importedAt, sessionId)) scope = 'session';
  if (scope === undefined) return undefined;
  try { out[RELEASE_TICKET_META] = mintReleaseTicket({ site, importedAt, scope }, { ...(o.ticketDir ? { dir: o.ticketDir } : {}), now }); }
  catch { return undefined; /* no ticket → the browser refuses (fail closed) */ }
  return out;
}
