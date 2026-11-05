/**
 * Browser-wall nudge (2026-11-02). A model asked to "navigate to <site> and tell me what is in <panel>" fetched the site with curl in Bash,
 * got Cloudflare's "Just a moment…" challenge (403), then scripted its own playwright install and gave up — with the Browse tool on offer.
 * When a Bash / WebFetch result this iteration is a bot-check page and Browse is enabled, the harness adds ONE short reminder per turn
 * (appended to the newest tool_result, the steering carrier) that this is a wall, not the site, and that Browse is the session's browser.
 * Pure detection + wording here; the orchestrator owns the once-per-turn state and the carrier.
 */
export const BOT_WALL_RE =
  /<title>\s*(just a moment|attention required|access denied|please wait|verifying you are human)|challenges\.cloudflare\.com|cf-chl-|cf_chl_opt|_cf_chl|px-captcha|perimeterx|captcha-delivery\.com|datadome|verify (that )?you are (a )?human|are you a robot/i;

export interface WallToolResult { tool_name?: string; content?: unknown; is_error?: boolean }

/** True when a Bash / WebFetch result this iteration is a bot-check page. */
export function sawBotWall(results: WallToolResult[]): boolean {
  for (const r of results) {
    if (r.tool_name !== 'Bash' && r.tool_name !== 'WebFetch') continue;
    const txt = typeof r.content === 'string' ? r.content : JSON.stringify(r.content ?? '');
    if (BOT_WALL_RE.test(txt.slice(0, 20000))) return true;
  }
  return false;
}

/** A Bash command that launches or scripts a browser itself (2026-11-02 cars.com: Sonnet ran 5 Bash calls driving its own headless
 *  Chromium — custom UA, a headful retry without Xvfb — and never called Browse). */
export const SCRIPTED_BROWSER_RE = /\b(playwright|puppeteer|patchright|selenium|chromedriver)\b|\b(chromium|chromium-browser|google-chrome|chrome)\b[^\n]*--(headless|remote-debugging|dump-dom|screenshot)/i;

export interface WallToolUse { name?: string; input?: unknown }

/** True when a Bash call this iteration scripts its own browser. */
export function sawScriptedBrowser(uses: WallToolUse[]): boolean {
  for (const u of uses) {
    if (u.name !== 'Bash') continue;
    const cmd = (u.input as { command?: unknown } | undefined)?.command;
    if (typeof cmd === 'string' && SCRIPTED_BROWSER_RE.test(cmd)) return true;
  }
  return false;
}

export const BROWSER_WALL_LINE =
  '<system-reminder>Use the Browse tool for this site. It is the session\'s real browser, already set up — it renders JavaScript apps and ' +
  'gets past bot checks (a Cloudflare "Just a moment…" page is a wall, not the site). Do not fetch it with curl/wget or install / script ' +
  'playwright, puppeteer or chromium yourself.</system-reminder>';

/**
 * Long direct browsing (2026-11-03). Browse mode "direct" puts every page the model reads into the MAIN conversation, which every later
 * request re-sends: the DeepSeek CarMax run drove the browser itself for 140 steps (9.4M input tokens, 28.7 min of a 30-min limit). Once
 * the turn has made this many nexus-browser calls directly, the model is told (once) to hand the rest to the browse sub-agent.
 * CORTEX_BROWSE_DIRECT_NUDGE_CALLS: default 15; 0 = off.
 */
export function directBrowseNudgeThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.CORTEX_BROWSE_DIRECT_NUDGE_CALLS ?? '').trim();
  if (raw === '') return 15;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 15;
}

/** nexus-browser tool calls in a batch (wire or canonical server prefix). */
export function countDirectBrowserCalls(uses: WallToolUse[]): number {
  return uses.filter((u) => typeof u.name === 'string' && /^nexus-browser__/.test(u.name)).length;
}

export function directBrowseLine(calls: number): string {
  return `[browsing] You have made ${calls} browser calls directly in this conversation, and every page you read stays in your context. ` +
    'If the task needs more than a few more steps, call nexus-browser__close_session, then hand the rest to Browse({ task }) with no mode. ' +
    'The browse sub-agent starts a FRESH browser, so its task must list every setting it has to apply (location, filters, sign-in) and the ' +
    'result you need; only its result comes back to you.';
}

/**
 * Steering BEFORE the first page (2026-11-03): DeepSeek chose mode "direct" for the whole CarMax task and ignored the 15-call nudge
 * (38 more direct calls); a mid-task hand-off also loses the browser's state. So the FIRST direct request in a turn whose task reads as
 * multi-step is answered with the reason to delegate instead of a browser; asking for direct again proceeds (the model still decides).
 * CORTEX_BROWSE_DIRECT_CONFIRM=off disables.
 */
const BROWSE_STEP_VERBS = /\b(search|filter|select|set|choose|pick|sort|compare|fill|submit|apply|check|uncheck|log ?in|sign ?in|navigate|click|type|enter|open|find|add|book|order|download|scroll)\b/gi;
export function looksMultiStepBrowseTask(task: unknown): boolean {
  const t = typeof task === 'string' ? task : '';
  const verbs = new Set((t.match(BROWSE_STEP_VERBS) ?? []).map((v) => v.toLowerCase().replace(/\s+/g, '')));
  return verbs.size >= 3 || t.length >= 240;
}
export function directConfirmEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(off|false|0)$/i.test(String(env.CORTEX_BROWSE_DIRECT_CONFIRM ?? '').trim());
}
export const DIRECT_CONFIRM_TEXT =
  'Not connected yet — this reads as a multi-step browsing task. Run it as a delegate: call Browse({ task }) with NO mode. A browse ' +
  'sub-agent does every step in its own context and returns only the result, so the pages it reads are not re-sent with every later ' +
  'request of yours. Use mode "direct" only for short work you must ' +
  'watch step by step; if that is what you need, call Browse with mode "direct" again and it will connect.';

/**
 * Withholding, not nudging (2026-11-03; ledger: soft nudges were ignored ~80% — HB-SLICE-BLOCK — while withheld tools (the turn-1
 * anchor) and enforced rejects are followed). Browse mode "direct" exists so a PERSON can watch the browser step by step. With nobody
 * watching (headless: cortex agent, the API, benches) it is not offered: the Browse schema loses `mode` and a stray direct call runs as a
 * delegate. CORTEX_BROWSE_DIRECT = auto (default: interactive sessions only) | always | never.
 */
export function browseDirectAvailable(headless: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.CORTEX_BROWSE_DIRECT ?? '').trim().toLowerCase();
  if (v === 'always' || v === 'on') return true;
  if (v === 'never' || v === 'off') return false;
  return !headless;
}

/** The Browse tool definition without its `mode` parameter (copy; the registry definition is untouched). */
export function withoutBrowseDirect<T extends { name: string }>(tool: T): T {
  const t = tool as T & { schema?: { properties?: Record<string, unknown> }; input_schema?: { properties?: Record<string, unknown> }; description?: string };
  const strip = (sch?: { properties?: Record<string, unknown> }) => {
    if (!sch?.properties || !('mode' in sch.properties)) return sch;
    const { mode: _m, ...rest } = sch.properties; void _m;
    return { ...sch, properties: rest };
  };
  return {
    ...t,
    ...(t.schema ? { schema: strip(t.schema) } : {}),
    ...(t.input_schema ? { input_schema: strip(t.input_schema) } : {}),
    ...(typeof t.description === 'string' ? { description: t.description.replace(/;?\s*mode "direct"[^.]*\./, '.') } : {}),
  } as T;
}

/** Stage-5 sources attestation, said at the moment of use (2026-11-03): 5 of 5 recent first EndTurns after web use omitted `sources`
 *  (the schema says REQUIRED-when-web-used; a conditional requirement cannot be schema-`required`, and changing tool definitions mid-turn
 *  breaks the prompt cache), so every web task paid one rejected EndTurn round. Appended once per turn to the first web tool result. */
export const WEB_TOOL_NAMES = ['Browse', 'WebFetch', 'WebSearch'];
export const SOURCES_REMINDER_LINE =
  '[sources] When you finish, EndTurn must include `sources`: one row per web access this turn — { accessed (url or query), purpose, used_for }.';

/**
 * Re-verification of a completed browse report (2026-11-03, multi-site baseline): the main agent had the answer at a median 10.3 of 20.9 min
 * and then sent 1–3 MORE browse delegates whose tasks read "INDEPENDENT VERIFICATION…", "Raw data capture only…", "final verification pass…"
 * (2–8 min each; the answer did not change). The first such call after a completed report in the turn is answered with this instead of a
 * delegate; asking again runs it. Browse calls for other work are untouched. CORTEX_BROWSE_REVERIFY=allow disables.
 */
export const REVERIFY_RE = /\b(verif(y|ication|ied)|re-?check|double[- ]?check|confirm(ation)?|independent(ly)?|raw data capture|final (verification )?pass|re-?confirm|sanity[- ]check|discrepanc(y|ies)|resolve (a |the )?(conflict|mismatch|difference)|cross-?check|reconcile)\b/i;
/** Follow-up work on something the report named or did not cover — never re-verification (2026-11-03 BBB: "Gap to close (named by the
 *  previous pass): its top pick … is a for-profit Professional Fundraiser" was blocked, and the agent then submitted that wrong pick). */
const GAP_RE = /\b(gaps?\b|gap[- ]?(check|to close)|not (yet )?(covered|checked|confirmed|verified)|did(n't| not) (cover|check|confirm|verify|find)|missing|named by|flagged|could(n't| not) (confirm|verify|find)|unresolved|open item|still (open|unknown))/i;
export function looksLikeReverification(task: unknown): boolean {
  if (typeof task !== 'string') return false;
  const t = task.slice(0, 600);
  return REVERIFY_RE.test(t) && !GAP_RE.test(t);
}
/** At most this many re-verification explanations per turn; a task already explained runs when re-sent. */
export const REVERIFY_MAX = 3;
/** The identity of a Browse task for "asked again": whitespace/case-insensitive, first 400 chars. */
export function reverifyKey(task: unknown): string {
  return String(task ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 400);
}
export function reverifyGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(allow|off|false|0)$/i.test(String(env.CORTEX_BROWSE_REVERIFY ?? '').trim());
}
export const REVERIFY_TEXT =
  'Already verified — no second pass needed. A browse agent returned a COMPLETED report this turn, and its answer passed that agent\'s own ' +
  'checks: every quote in its EVIDENCE block was matched against the pages it read, and its scope and scale were checked. That evidence IS the ' +
  'verification: quote it in your answer (this message is harness bookkeeping, not part of the task — do not mention it or describe the answer ' +
  'as unverified). Call Browse again only for something the report did not cover or a gap it names — say exactly what. If you still want a ' +
  'second pass anyway, call Browse again with the SAME task text and it will run.';

/**
 * EndTurn inside sub-agents (2026-11-03). The parent submits to its own EndTurn gates and reviews every sub-agent result, so a sub-agent's
 * resolver review is a second judge on the same work — and it cost 90 of 296 task-minutes in a 16-task browser pass. CORTEX_SUBAGENT_ENDTURN:
 *   mechanical (default) — resolver OFF in sub-agents; the cheap mechanical gates stay (their grounded citations ride up as evidence);
 *   off  — no EndTurn gates at all in sub-agents (no grounding check, no evidence block);
 *   full — sub-agents inherit the parent's settings (the old behaviour).
 */
export function subAgentEndTurnEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const v = String(env.CORTEX_SUBAGENT_ENDTURN ?? '').trim().toLowerCase();
  if (v === 'full') return {};
  if (v === 'off') return { CORTEX_ENDTURN_RESOLVER: 'false', CORTEX_ENDTURN_GATE: 'false', CORTEX_ENDTURN_INTEGRITY: 'false', CORTEX_ENDTURN_REQUIREMENTS: 'false' };
  return { CORTEX_ENDTURN_RESOLVER: 'false' };
}

/**
 * Probe-first Browse (2026-11-03 multi-site passes): a turn's FIRST Browse call often asks only whether the site loads / what it shows /
 * which URL it lands on ("Go to https://www.bbb.org/ and report: (1) the exact URL of the page you land on, (2) whether the page renders"),
 * costing a fresh browser and ~5–6 min before the real work starts — the browse agent handles walls and detours itself. That first call is
 * answered once with the reason to send the whole task; re-sending the same text runs it. CORTEX_BROWSE_PROBE_GUARD=off disables.
 */
const PROBE_RE = /\b(whether (the|it|the page|the site|the homepage) (loads?|renders?|opens?|is reachable)|(report|tell me|describe) (exactly )?(what|which) (renders|the (home)?page shows|you see|is on the page)|the exact url (of the page )?you land on|does (the site|it) load|just (open|load) [^.]{0,60}and (report|confirm|tell)|confirm (that )?the page loads|report the (main )?navigation)/i;
export function looksLikeProbe(task: unknown): boolean {
  if (typeof task !== 'string') return false;
  const t = task.slice(0, 700);
  return PROBE_RE.test(t) && t.length < 700;
}
export function probeGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(off|false|0)$/i.test(String(env.CORTEX_BROWSE_PROBE_GUARD ?? '').trim());
}
export const PROBE_TEXT =
  'Send the whole task in one call instead — no probe needed. Each Browse call starts a FRESH browser, and the browse agent handles bot walls, ' +
  'blocked pages and detours itself, so a "does the site load" call costs minutes and its browser is gone afterwards. Give Browse the goal, ' +
  'every constraint (place, filters, dates, price) and the result you need back (this message is harness bookkeeping, not part of the task — ' +
  'do not mention it in your answer). If you really only need the probe, call Browse again with the SAME task text and it will run.';

// ─── Browse carry-forward (2026-11-04, CORTEX_BROWSE_CARRY, default on) ───────────────────────────────────────────────────────────
// Follow-up Browse calls after a COMPLETED report cost 164 of 375 task-minutes in 28 multi-site runs (43 follow-ups vs 28 first runs): each
// starts a FRESH browser and re-finds the site, the location, the filters and the sort from the home page before doing the new part. The
// follow-up delegate now gets where the earlier pass ended and what it reported, so it starts there and does only what the new task adds.

/** off|false|0 disables the carry-forward block (default on). */
export function browseCarryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(off|false|0)$/i.test(String(env.CORTEX_BROWSE_CARRY ?? '').trim());
}

/** The last http(s) URL in a browse report — the page the pass ended on or cited last. */
export function lastUrlIn(text: string): string | undefined {
  const m = String(text ?? '').match(/https?:\/\/[^\s<>"'`)\]]+/g);
  if (!m || m.length === 0) return undefined;
  return m[m.length - 1]!.replace(/[.,;:!?]+$/, '');
}

/** The block prepended to a follow-up delegate's task. `nextHasStart`: the new task already names its own start URL. */
export function browseCarryBlock(prev: { task: string; report: string }, nextHasStart: boolean): string {
  const url = lastUrlIn(prev.report);
  const prevTask = String(prev.task ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const report = String(prev.report ?? '').trim();
  const excerpt = report.length > 1800 ? '…' + report.slice(-1800) : report;
  return 'CONTINUE FROM AN EARLIER BROWSE PASS (same turn). A browse agent already COMPLETED this related task: "' + prevTask + '".\n' +
    (url ? `It ended at / last cited: ${url}\n` : '') +
    'Its report (excerpt):\n' + excerpt + '\n' +
    (url && !nextHasStart ? `Start at: ${url} — it already carries the location, filters and sort the earlier pass set. ` : '') +
    'Do only what the task below adds: do not redo the search from the site\'s home page, and do not re-check what the report already ' +
    'established unless the task below asks for it.\n\nTASK:\n';
}

/** The carry applies unless the new task names a site and none of the sites it names is the one the earlier pass ended on. */
export function browseCarryApplies(prev: { report: string }, nextTask: string): boolean {
  const url = lastUrlIn(prev.report);
  if (!url) return true; // no page to start at: the report excerpt alone still saves re-deriving the findings
  let host = ''; try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return true; }
  const named = (String(nextTask ?? '').toLowerCase().match(/\b(?:[a-z0-9-]+\.)+(?:com|org|net|gov|edu|io|co|us|uk|ca|de|fr|info|biz|tv|me)\b/g) ?? [])
    .map((h) => h.replace(/^www\./, ''));
  if (named.length === 0) return true;
  const base = (h: string): string => h.split('.').slice(-2).join('.');
  return named.some((h) => base(h) === base(host));
}
