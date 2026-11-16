/**
 * sessionLoadTool — the `load_session` tool (vault task T3), library-first.
 *
 * The browser package's `local.ts` is not part of this public tree, so the tool REGISTRATION lives there; everything that can
 * live in core lives here and the browser glue is one line:
 *
 *   registerTool('load_session', (args, ctx) => runLoadSession(args, await ctx.context.newCDPSession(ctx.page), { ask }))
 *
 * The glue must also pass the permission context's `sessionId` in those opts (`{ ask, sessionId: ctx.permissionContext.sessionId }`):
 * a pre-approval recorded by the floor's dialog is bound to the session that answered it, and a release with no `sessionId`
 * consumes none — it falls back to the tool's own `ask` (fail closed, never a silent release).
 *
 * CDP route — chosen: Playwright `context.newCDPSession(page)` + `Network.setCookies`. NOT `context.addCookies`.
 * Reason: fidelity. `context.addCookies` takes a simplified cookie shape and does not expose Chrome's CHIPS `partitionKey`
 * ({ topLevelSite, hasCrossSiteAncestor }), and it re-derives httpOnly / sameSite / expires semantics on the way in. The vault
 * stores exactly what the browser reported (partitioned cookies included), and `Network.setCookies` is the one route that
 * accepts the stored fields 1:1 — so a partitioned session cookie is restored as a partitioned cookie, not silently flattened
 * into an unpartitioned one (which would leak it across top-level sites).
 *
 * What it never does: return a cookie value, put one in an error, or put one in the release log. The tool result is
 * `{ site, loaded }` plus `expired` / `skipped` ONLY when non-zero.
 */
import {
  releaseSite,
  type Ask,
  type CdpLike,
  type ReleaseAnswer,
  type ReleaseOptions,
  type ReleaseResult,
} from './sessionRelease.js';
import type { ReleaseMode } from './sessionVault.js';
import { consumeReleaseTicket, RELEASE_TICKET_META } from './sessionTicket.js';

/**
 * The names the tool answers to: the MCP-qualified one the model calls, and the bare one.
 *
 * Both are guarded by the `floor-load-session` floor policy (DefaultPolicies.ts, priority 9_998), which runs before everything
 * else and refuses a release with no standing grant. The separate `load-session-tool` whitelist entry (priority 500) does NOT
 * rescue the tool from the default policy — PermissionEvaluator returns ALLOWED when every policy passes through and consults
 * the default policy only when no policy evaluated at all — it exists to classify the tool explicitly and attributably, and it
 * sits below the floor so it can never release what the floor refused.
 */
export const loadSessionToolNames = ['nexus-browser__load_session', 'load_session'] as const;
export type LoadSessionToolName = (typeof loadSessionToolNames)[number];

export interface LoadSessionArgs { site: string; mode?: ReleaseMode }
/** Exactly what the tool returns. `expired` / `skipped` appear only when they are greater than zero. */
export interface LoadSessionResult { site: string; loaded: number; expired?: number; skipped?: number }

const MODES: readonly ReleaseMode[] = ['once', 'session', 'always'];

/** Validate the tool arguments the way the vault validates a site: refuse rather than guess. */
function parseArgs(args: LoadSessionArgs): { site: string; mode: ReleaseMode } {
  if (!args || typeof args !== 'object') throw new Error('load_session needs { site } — the registrable domain to release');
  const site = args.site;
  if (typeof site !== 'string' || !site.trim()) throw new Error('load_session needs a site: the registrable domain (e.g. github.com)');
  const mode = args.mode === undefined ? 'once' : args.mode;
  if (!MODES.includes(mode as ReleaseMode)) throw new Error(`invalid mode "${String(mode)}": use once, session or always`);
  return { site: site.trim().toLowerCase(), mode: mode as ReleaseMode };
}

/**
 * Run the tool: validate, then hand off to `releaseSite` (which owns the vault check, the ask, the grant and the audit log).
 * The result is narrowed to `{ site, loaded }` (+ `expired` / `skipped` when > 0) — a value can never travel back to the model.
 */
export async function runLoadSession(
  args: LoadSessionArgs,
  cdp: CdpLike,
  opts: ReleaseOptions,
): Promise<LoadSessionResult> {
  const { site, mode } = parseArgs(args);
  const released: ReleaseResult = await releaseSite(site, mode, cdp, opts);
  const out: LoadSessionResult = { site: released.site, loaded: released.loaded };
  if (typeof released.expired === 'number' && released.expired > 0) out.expired = released.expired;
  if (typeof released.skipped === 'number' && released.skipped > 0) out.skipped = released.skipped;
  return out;
}

// ── the browser PROCESS side (release ticket) ───────────────────────────────
/**
 * Run `load_session` in the browser process, where nobody can be asked: the user's answer arrives as the release ticket the harness
 * minted, in the MCP request's `_meta` (RELEASE_TICKET_META, sessionTicket.ts) — pass the handler's `extra._meta` as `meta`. With a valid ticket for this site the release uses its scope; without one only an
 * 'always' grant on disk can release (releaseSite reads it), and anything that would need a question is refused — never asked,
 * never guessed. The ticket id is never echoed back.
 */
export async function runLoadSessionFromCall(
  args: LoadSessionArgs,
  meta: Record<string, unknown> | undefined,
  cdp: CdpLike,
  opts: Omit<ReleaseOptions, 'ask' | 'ticket' | 'sessionId'> & { ticketDir?: string } = {},
): Promise<LoadSessionResult & { refused?: string }> {
  const { site } = parseArgs(args);
  const t = consumeReleaseTicket(meta?.[RELEASE_TICKET_META], site, opts.ticketDir ? { dir: opts.ticketDir } : {});
  let asked = false;
  const { ticketDir: _td, ...rest } = opts;
  const r = await runLoadSession({ site, ...(args.mode !== undefined ? { mode: args.mode } : {}) }, cdp, {
    ...rest,
    ...(t ? { ticket: { scope: t.scope, importedAt: t.importedAt } } : {}),
    ask: () => { asked = true; return 'no'; },
  });
  return asked && r.loaded === 0
    ? { ...r, refused: `not approved: the user was not asked for ${site} in this call (approve it when the harness asks, or grant it "always" in /signins)` }
    : r;
}

// ── the approval dialog → the 4-way answer ──────────────────────────────────
/**
 * What a harness approval dialog can hand back. `ApprovalHandler.requestApproval` returns `ApprovalAnswer` — a bare boolean
 * (legacy handlers) or `{ approved, scope }` — and the harness dialogs really do offer four choices for a `load_session`
 * request: allow once / allow for this session / always allow for this site / deny. The chosen word and the two decision
 * objects are also accepted so the adapter does not depend on which shape a given harness version emits.
 */
export type DialogAnswer =
  | boolean
  | 'once' | 'session' | 'always' | 'no'
  | { approved: boolean; scope?: 'once' | 'session' | 'always'; remember?: boolean; rememberSession?: boolean };

/** The narrow handler shape the adapter needs — structurally satisfied by ApprovalHandler. */
export type DialogHandler = (request: { toolName: string; toolInput: Record<string, unknown>; reason: string }) => Promise<DialogAnswer> | DialogAnswer;

/** Map one dialog answer to the 4-way Ask. Anything unrecognised is 'no': an unknown answer must never release a session. */
export function answerToAsk(answer: DialogAnswer): ReleaseAnswer {
  if (answer === true) return 'once';
  if (answer === false) return 'no';
  if (answer === 'once' || answer === 'session' || answer === 'always' || answer === 'no') return answer;
  if (answer && typeof answer === 'object') {
    if (answer.approved !== true) return 'no';
    if (answer.scope === 'session' || answer.rememberSession === true) return 'session';
    if (answer.scope === 'always' || answer.remember === true) return 'always';
    return 'once';
  }
  return 'no';
}

/**
 * Turn the harness approval dialog into the 4-way `Ask` that `releaseSite` expects. The prompt text is passed through as the
 * reason so the dialog shows the same question the vault would have asked.
 */
export function askFromApprovalHandler(handler: DialogHandler, toolName: LoadSessionToolName = 'nexus-browser__load_session'): Ask {
  if (!handler || typeof handler !== 'function') throw new Error('an approval handler is required');
  return async (prompt: string, options: readonly ReleaseAnswer[]): Promise<ReleaseAnswer> => {
    const answer = await handler({ toolName, toolInput: { options: [...options] }, reason: prompt });
    return answerToAsk(answer);
  };
}
