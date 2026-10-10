/**
 * AttemptController — the R194 SECOND-ATTEMPT CHAIN in the LIBRARY (R239 / unification plan P4, 2026-10-07).
 *
 * Operator rule (10-06): "the library IS the harness; the adapter must never decide." Until this module the chain lived in the bench
 * adapter (nexus_cortex_agent.py `_SA_SNAPSHOT` / `_SA_CHAIN` / sa_go / sa_pick / sa_merge, commit 2bd888751): serverless and streaming
 * callers could not get it, and its levers were absent from the library ledger. This file ports the decision (sa_go), the selection
 * (sa_pick), the usage merge (sa_merge) and the shipped-check detection VERBATIM as pure functions, plus `runWithAttempts`, the runner that
 * sits ABOVE the turn loop: snapshot → attempt 1 → decide from the last resolver verdict (in-process) → fresh orchestrator per extra
 * attempt (own state dir + sessions dir + reduced deadline) → shipped check → select → restore → merged response.
 *
 * Levers (CORTEX_SECOND_ATTEMPT*, default off = byte-identical): see `resolveSecondAttemptConfig`.
 * Artifacts (parity with the adapter's banked files, written to CORTEX_SECOND_ATTEMPT_OUT_DIR or <stateDir>/attempts):
 *   a<k>.json (the decision after attempt k), response.attempt<k>.json, decisions.attempt<k>.jsonl, session.attempt<k>.jsonl,
 *   check<k> (pass|fail|skipped), chk<k>.txt (the check output), second-attempt.json (the selection record, R194 v1 shape kept).
 * Events: `second_attempt` rows in attempt 1's decision store {phase: decision|selection, ...}.
 * Every failure at every step leaves attempt 1 (or the chosen finished attempt) in place — fail-open, like the adapter.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import type { CortexOrchestrator, OrchestratorResponse, SendMessageOptions } from './CortexOrchestrator.js';
import { resolveTurnDeadlineMs } from './timeBudget.js';
import { resolveCortexStateDir } from '../utils/stateDir.js';
import { WorkspaceSnapshot } from '../utils/workspaceSnapshot.js';
import { sumSessionUsage, type SessionUsage } from '../training/usageAccounting.js';

// ---------------------------------------------------------------------------------------------------------------------------------
// Levers
// ---------------------------------------------------------------------------------------------------------------------------------

/** Default trigger set — PROMOTED 2026-10-10 (operator): the WIDENED set. A confident `accept` and a give-up (`none`) reopen too, while
 *  ≥ MIN_REMAINING of the clock is left. Evidence: TB4 cells 3+4 on the 14 c23 tasks — adapter chain 9 + 10 /14 (two-repeat best of the
 *  arc; the narrow set's bundle scored 8 + 8), library chain 8 + 7 /14 with identical decisions. The narrow set (`accept-with-gap,
 *  accept-low-confidence`) stays available through CORTEX_SECOND_ATTEMPT_TRIGGER. */
export const SECOND_ATTEMPT_DEFAULT_TRIGGER = ['accept-with-gap', 'accept-low-confidence', 'accept', 'none'] as const;
/** The pre-promotion default (cells before 2026-10-10 that set no trigger ran this). */
export const SECOND_ATTEMPT_NARROW_TRIGGER = ['accept-with-gap', 'accept-low-confidence'] as const;
/** Verdicts that rank between a confident accept and no finish (sa_pick's SA_GAP). */
export const SECOND_ATTEMPT_GAP_ACTIONS = new Set<string>(['accept-with-gap', 'accept-low-confidence']);

export interface SecondAttemptConfig {
  /** CORTEX_SECOND_ATTEMPT = 1|true|on */
  enabled: boolean;
  /** CORTEX_SECOND_ATTEMPT_MAX — maximum number of EXTRA attempts (default 1; 0 = none; non-integer → 1) */
  max: number;
  /** CORTEX_SECOND_ATTEMPT_MIN_REMAINING — fraction of the ORIGINAL deadline that must remain (default 0.5) */
  minRemaining: number;
  /** CORTEX_SECOND_ATTEMPT_TRIGGER — resolver actions that open another attempt; the token `none` = a give-up (no verdict) */
  trigger: string[];
  /** CORTEX_SECOND_ATTEMPT_RESERVE_MS — wall-clock reserve subtracted from the next attempt's deadline (default 300000) */
  reserveMs: number;
  /** CORTEX_SECOND_ATTEMPT_FLOOR_MS — the next attempt must have at least this much after the reserve (default 900000) */
  floorMs: number;
  /** CORTEX_SECOND_ATTEMPT_OUT_DIR — where the per-attempt artifacts + second-attempt.json are written (default <stateDir>/attempts) */
  outDir: string | null;
  /** Wall-clock cap for one shipped-check run (the adapter's `timeout 300`). */
  checkTimeoutMs: number;
  /** CORTEX_SECOND_ATTEMPT_SELECT — `verdict` (default; the adapter's order: verdict rank → fewest turns → judge checks → earliest) or
   *  `evidence` (R246: shipped check → ACCEPTED-class first (any accept beats veto/none) → fewest turns → verdict rank → checks → earliest —
   *  demotes the accept-vs-gap distinction, which cells 3+4 showed to be judge noise: last-verdict accuracy 0.31–0.77). */
  select: 'verdict' | 'evidence';
  /** CORTEX_SECOND_ATTEMPT_UNTIL_BUDGET = 1|true|on — R247: ignore the extra-attempt COUNT cap while ≥ MIN_REMAINING of the clock is left
   *  (reserve + floor still apply). Cells 3+4: 18/19 fails ended with ≥ 50 % unused while MAX=2 had closed the chain. */
  untilBudget: boolean;
}

export function resolveSecondAttemptConfig(env: NodeJS.ProcessEnv = process.env): SecondAttemptConfig {
  const intOr = (v: unknown, d: number): number => { const s = String(v ?? '').trim(); return /^-?\d+$/.test(s) ? parseInt(s, 10) : d; };
  const minRaw = String(env.CORTEX_SECOND_ATTEMPT_MIN_REMAINING ?? '').trim();
  const minRemaining = minRaw !== '' && Number.isFinite(Number(minRaw)) ? Number(minRaw) : 0.5;
  const trigger = String(env.CORTEX_SECOND_ATTEMPT_TRIGGER || SECOND_ATTEMPT_DEFAULT_TRIGGER.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  return {
    enabled: /^(1|true|on)$/i.test(String(env.CORTEX_SECOND_ATTEMPT ?? '').trim()),
    max: Math.max(0, intOr(env.CORTEX_SECOND_ATTEMPT_MAX || 1, 1)),
    minRemaining,
    trigger,
    reserveMs: Math.max(0, intOr(env.CORTEX_SECOND_ATTEMPT_RESERVE_MS || 300_000, 300_000)),
    floorMs: Math.max(0, intOr(env.CORTEX_SECOND_ATTEMPT_FLOOR_MS || 900_000, 900_000)),
    outDir: String(env.CORTEX_SECOND_ATTEMPT_OUT_DIR ?? '').trim() || null,
    checkTimeoutMs: 300_000,
    select: /^evidence$/i.test(String(env.CORTEX_SECOND_ATTEMPT_SELECT ?? '').trim()) ? 'evidence' : 'verdict',
    untilBudget: /^(1|true|on)$/i.test(String(env.CORTEX_SECOND_ATTEMPT_UNTIL_BUDGET ?? '').trim()),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The decision after attempt k (sa_go)
// ---------------------------------------------------------------------------------------------------------------------------------

/** What the orchestrator remembers of the LAST endturn_resolver adjudication of a turn (CortexOrchestrator.getLastResolverDecision). */
export interface LastResolverDecision {
  action: string | null;
  confidence?: string;
  namedPassed?: number;
  checkPassed?: boolean | null;
  remainingFrac?: number | null;
  error?: string;
  ts: number;
}

export interface AttemptDecisionInput {
  /** the attempt that just finished (1-based) */
  k: number;
  /** the last resolver action of that attempt; null/undefined = no verdict (a give-up) */
  action: string | null | undefined;
  /** that attempt's own remainingFrac (relative to ITS deadline) — recorded, used only for attempt 1 when no start epoch is known */
  eventRemainingFrac?: number | null;
  namedPassed?: number | null;
  checkPassed?: boolean | null;
  /** task-start epoch (ms); null = unknown */
  t0Ms?: number | null;
  /** the ORIGINAL deadline (ms) */
  deadlineMs: number;
  nowMs: number;
  cfg: SecondAttemptConfig;
}

export interface AttemptDecision {
  k: number;
  action: string | null;
  remainingFrac: number | null;
  eventRemainingFrac: number | null;
  deadlineMs: number;
  elapsedMs: number | null;
  remainingMs: number;
  nextDeadlineMs: number;
  namedPassed: number;
  checkPassed: boolean | null;
  trigger: string[];
  minRemaining: number;
  max: number;
  extraSoFar: number;
  go: boolean;
  why: string;
}

/** sa_go, verbatim: remaining time is measured on the WALL CLOCK against the ORIGINAL deadline (t0 + deadline − now); an attempt's own
 *  remainingFrac is relative to its shortened deadline and is never used for the decision (except attempt 1 with no start epoch, whose
 *  frac IS on the original basis). Conditions in order: trigger → frac ≥ min → floor after reserve → extra-attempt cap. Pure. */
export function decideNextAttempt(i: AttemptDecisionInput): AttemptDecision {
  const { cfg } = i;
  const dl = Number.isFinite(i.deadlineMs) && i.deadlineMs > 0 ? Math.floor(i.deadlineMs) : 0;
  const ev = typeof i.eventRemainingFrac === 'number' && Number.isFinite(i.eventRemainingFrac) ? i.eventRemainingFrac : null;
  let elapsed: number | null = null;
  let rem = 0;
  if (typeof i.t0Ms === 'number' && Number.isFinite(i.t0Ms) && dl > 0) { elapsed = Math.floor(i.nowMs - i.t0Ms); rem = dl - elapsed; }
  else if (i.k === 1 && ev !== null && dl > 0) rem = Math.floor(ev * dl); // no start epoch: attempt 1's own frac IS on the original basis
  const frac = dl > 0 ? rem / dl : null;
  const action = i.action ?? null;
  const actKey = action ?? 'none'; // a give-up (no resolver verdict) matches the trigger token 'none'
  let why: string;
  if (!cfg.trigger.includes(actKey)) why = 'action not in trigger set';
  else if (frac === null || frac < cfg.minRemaining) why = 'remaining fraction of the original deadline below minimum';
  else if (rem - cfg.reserveMs < cfg.floorMs) why = `less than ${Math.round(cfg.floorMs / 60_000)} min would remain after the ${Math.round(cfg.reserveMs / 60_000)} min reserve`;
  else if (!cfg.untilBudget && i.k - 1 >= cfg.max) why = 'extra-attempt cap reached';
  else why = 'continue';
  return {
    k: i.k, action, remainingFrac: frac === null ? null : Math.round(frac * 10_000) / 10_000, eventRemainingFrac: ev, deadlineMs: dl,
    elapsedMs: elapsed, remainingMs: rem, nextDeadlineMs: Math.max(600_000, rem - cfg.reserveMs),
    namedPassed: typeof i.namedPassed === 'number' ? i.namedPassed : 0, checkPassed: i.checkPassed ?? null,
    trigger: [...cfg.trigger], minRemaining: cfg.minRemaining, max: cfg.untilBudget ? Number.POSITIVE_INFINITY : cfg.max, extraSoFar: i.k - 1, go: why === 'continue', why,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Selection over attempts 1..n (sa_pick)
// ---------------------------------------------------------------------------------------------------------------------------------

export type ShippedCheckResult = 'pass' | 'fail' | 'skipped' | 'none';

export interface AttemptRecord {
  k: number;
  action: string | null;
  remainingFrac: number | null;
  namedPassed: number;
  check: ShippedCheckResult;
  /** metadata.toolCallIterations of the attempt's response (null when absent) */
  iterations: number | null;
  /** tool-call assistant records in the attempt's session file (null when absent) */
  sessionTurns: number | null;
  /** attempt 1 always; k ≥ 2 only with a response, a verdict and a committed tree */
  finished: boolean;
  /** the attempt's request exit code as a string (null = unknown) */
  rc: string | null;
  /** filled by selectAttempt from `turnsSource` */
  turns?: number | null;
}

export interface AttemptSelection {
  /** R246: which selection order produced the pick */
  selectMode?: 'verdict' | 'evidence';
  pick: number;
  why: string;
  attempts: AttemptRecord[];
  turnsSource: 'toolCallIterations' | 'session';
  shippedCheck: string | null;
  /** R194 v1 shape (attempt1 / attempt2 … keys) kept for existing readers (s2-read.py) */
  [attemptKey: `attempt${number}`]: { action: string | null; remainingFrac: number | null; namedPassed: number; check: ShippedCheckResult; rc: string | null; turns: number | null | undefined } | undefined;
}

/** accept 2 > accept-with-gap / accept-low-confidence 1 > anything else 0 */
export function rankVerdict(action: string | null | undefined): number {
  return action === 'accept' ? 2 : action && SECOND_ATTEMPT_GAP_ACTIONS.has(action) ? 1 : 0;
}

/** sa_pick, verbatim: (a) shipped check — when some candidates pass and others do not, keep the passing ones; (b) verdict rank;
 *  (c) FEWEST tool-call turns (r-selector 2026-09-28; promoted above namedPassed 2026-10-07); (d) more judge checks passed; (e) earliest.
 *  Candidates = attempt 1 always + every finished later attempt. Pure (mutates `turns` on the records it is given). */
export function selectAttempt(att: AttemptRecord[], shippedCheck: string | null, mode: 'verdict' | 'evidence' = 'verdict'): AttemptSelection {
  let cands = att.filter((x) => x.finished);
  // one turn measure for every candidate: toolCallIterations when all have it, else session tool-call turns
  const src: AttemptSelection['turnsSource'] = cands.every((x) => x.iterations !== null) ? 'toolCallIterations' : 'session';
  for (const x of att) x.turns = src === 'toolCallIterations' ? x.iterations : x.sessionTurns;
  const why: string[] = [];
  const unfinished = att.filter((x) => !x.finished).map((x) => x.k);
  if (unfinished.length) why.push('no finish: attempt ' + unfinished.join(','));
  const passing = cands.filter((x) => x.check === 'pass');
  if (passing.length && passing.length < cands.length) {
    cands = passing;
    why.push('shipped check passes only on attempt ' + passing.map((x) => x.k).join(','));
  }
  const BIG = 1e9;
  const steps: Array<[string, (x: AttemptRecord) => number]> = mode === 'evidence'
    ? [ // R246: an accepted finish (any accept) beats a veto/give-up, then evidence (fewest turns) before the judge's confidence
        ['accepted', (x) => (rankVerdict(x.action) > 0 ? 0 : 1)],
        ['fewest tool-call turns', (x) => (typeof x.turns === 'number' ? x.turns : BIG)],
        ['verdict', (x) => -rankVerdict(x.action)],
        ['more judge checks passed', (x) => -x.namedPassed],
        ['earliest attempt', (x) => x.k],
      ]
    : [
        ['verdict', (x) => -rankVerdict(x.action)],
        ['fewest tool-call turns', (x) => (typeof x.turns === 'number' ? x.turns : BIG)],
        ['more judge checks passed', (x) => -x.namedPassed],
        ['earliest attempt', (x) => x.k],
      ];
  let decided = why.length > 0 && why[why.length - 1]!.startsWith('shipped check');
  for (const [label, key] of steps) {
    if (cands.length <= 1) break;
    const best = Math.min(...cands.map(key));
    const nxt = cands.filter((x) => key(x) === best);
    if (nxt.length < cands.length) {
      if (label === 'earliest attempt' && !decided) why.push('no evidence separates the attempts; earliest');
      else why.push(`${label} (attempt ${nxt[0]!.k}` + (label === 'verdict' ? `, action ${nxt[0]!.action}` : '') + ')');
      decided = true;
    }
    cands = nxt;
  }
  const pick = cands.length ? cands[0]!.k : 1;
  if (!decided) why.push('only candidate');
  const out: AttemptSelection = { pick, why: why.join('; '), attempts: att, turnsSource: src, shippedCheck: shippedCheck || null, selectMode: mode };
  for (const x of att) out[`attempt${x.k}`] = { action: x.action, remainingFrac: x.remainingFrac, namedPassed: x.namedPassed, check: x.check, rc: x.rc, turns: x.turns };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Usage merge (sa_merge)
// ---------------------------------------------------------------------------------------------------------------------------------

/** The picked attempt's response with usage.session SUMMED over every attempt (+ usage/metadata.secondAttempt). A missing picked
 *  response falls back to the latest readable one. null when no attempt produced a response. */
export function mergeAttemptResponses(responses: Array<OrchestratorResponse | null | undefined>, selection: AttemptSelection): OrchestratorResponse | null {
  const n = responses.length;
  const p = selection.pick;
  const base = (p >= 1 && p <= n ? responses[p - 1] : null) ?? [...responses].reverse().find((r) => !!r) ?? null;
  if (!base) return null;
  let tot: SessionUsage | undefined;
  for (const r of responses) {
    const s = r?.usage?.session;
    if (s) tot = tot ? sumSessionUsage(tot, s) : sumSessionUsage(s, null);
  }
  return {
    ...base,
    usage: { ...base.usage, ...(tot ? { session: tot } : {}), secondAttempt: selection } as OrchestratorResponse['usage'] & { secondAttempt: AttemptSelection },
    metadata: { ...base.metadata, ...(tot ? { sessionUsage: tot } : {}), secondAttempt: selection } as OrchestratorResponse['metadata'],
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Shipped check (the workspace's own test entry point)
// ---------------------------------------------------------------------------------------------------------------------------------

/** ADP:165 verbatim: `make test` (a Makefile with a test target) → test.sh → run_tests.sh → pytest (pytest.ini or a tests/ or test/ dir). */
export function detectShippedCheck(workspace: string): string | null {
  const at = (p: string) => join(workspace, p);
  try {
    if (existsSync(at('Makefile')) && /^test\s*:/m.test(readFileSync(at('Makefile'), 'utf-8'))) return 'make test';
  } catch { /* unreadable Makefile = no make target */ }
  if (existsSync(at('test.sh'))) return 'sh ./test.sh';
  if (existsSync(at('run_tests.sh'))) return 'sh ./run_tests.sh';
  const isDir = (p: string) => { try { return statSync(at(p)).isDirectory(); } catch { return false; } };
  if (existsSync(at('pytest.ini')) || isDir('tests') || isDir('test')) return 'python3 -m pytest -q -x --no-header -p no:cacheprovider';
  return null;
}

/** Run the shipped check in the workspace (sh -c, bounded); the output is returned for banking. */
export function runShippedCheck(cmd: string, workspace: string, timeoutMs: number): { result: 'pass' | 'fail'; output: string } {
  try {
    const r = spawnSync('sh', ['-c', cmd], { cwd: workspace, encoding: 'utf-8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    return { result: r.status === 0 ? 'pass' : 'fail', output: r.error ? `${output}\n[attempt-controller] ${r.error.message}` : output };
  } catch (e) {
    return { result: 'fail', output: `[attempt-controller] ${String((e as Error)?.message ?? e)}` };
  }
}

/** Tool-call turns from a session record: assistant records carrying ≥ 1 tool_use block (null when the file is absent / unreadable). */
export function countSessionToolTurns(sessionPath: string | undefined): number | null {
  if (!sessionPath || !existsSync(sessionPath)) return null;
  try {
    let n = 0;
    for (const line of readFileSync(sessionPath, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      let r: any;
      try { r = JSON.parse(line); } catch { continue; }
      const blocks = r?.message?.content;
      if (Array.isArray(blocks) && blocks.some((b: any) => b && typeof b === 'object' && (b.type === 'tool_use' || b.toolUse))) n++;
    }
    return n;
  } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------------------------------------------------------------

export interface AttemptOrchestratorSpec {
  /** per-attempt runtime state root (decisions.jsonl, …) — pass as OrchestratorConfig.stateDir */
  stateDir: string;
  /** per-attempt sessions dir — pass as OrchestratorConfig.storageDir */
  storageDir: string;
  /** the reduced wall-clock deadline for this attempt — pass as loopControl.turnDeadlineMs */
  turnDeadlineMs: number;
}

export interface RunWithAttemptsOptions {
  /** attempt 1 runs on this instance (the server's persistent orchestrator, or the request's ephemeral one) */
  orchestrator: CortexOrchestrator;
  turnContent: Parameters<CortexOrchestrator['sendMessage']>[0];
  messageOptions?: SendMessageOptions;
  /** the task workspace (snapshotted / restored) */
  projectPath: string;
  /** builds a FRESH orchestrator for attempt k ≥ 2 (createOrchestrator + createSession); the runner calls cleanup() on it */
  createAttemptOrchestrator: (k: number, spec: AttemptOrchestratorSpec) => Promise<CortexOrchestrator>;
  env?: NodeJS.ProcessEnv;
  /** task-start epoch (ms); default = now at entry */
  t0Ms?: number;
  /** the ORIGINAL deadline (ms); default = CORTEX_TURN_DEADLINE_MS */
  deadlineMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}

/** metadata.toolCallIterations of a response (the non-streaming turn loop always sets it; typed loosely on OrchestratorResponse). */
function toolCallIterationsOf(resp: OrchestratorResponse | null | undefined): number | null {
  const v = (resp?.metadata as { toolCallIterations?: unknown } | undefined)?.toolCallIterations;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function writeJson(path: string, value: unknown): void {
  try { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 1), 'utf-8'); } catch { /* banking is best-effort */ }
}
function copyIf(src: string | undefined, dst: string): boolean {
  try { if (src && existsSync(src)) { mkdirSync(join(dst, '..'), { recursive: true }); copyFileSync(src, dst); return true; } } catch { /* best-effort */ }
  return false;
}

/** The chain. Returns the merged response (or attempt 1's when no further attempt ran / anything failed). */
export async function runWithAttempts(opts: RunWithAttemptsOptions): Promise<OrchestratorResponse> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? ((line: string) => console.warn(line));
  const cfg = resolveSecondAttemptConfig(env);
  const t0 = opts.t0Ms ?? now();
  const dl0 = opts.deadlineMs ?? resolveTurnDeadlineMs(undefined, env);
  const stateRoot = resolveCortexStateDir(opts.projectPath, env).dir;
  const attemptsDir = join(stateRoot, 'attempts');
  const artifactsDir = cfg.outDir ?? attemptsDir;
  const bank = (orch: CortexOrchestrator, k: number, response: OrchestratorResponse | null) => {
    const paths = typeof (orch as any).getAttemptArtifactPaths === 'function' ? (orch as any).getAttemptArtifactPaths() as { decisionsPath?: string; sessionPath?: string } : {};
    if (response) writeJson(join(artifactsDir, `response.attempt${k}.json`), response);
    copyIf(paths.decisionsPath, join(artifactsDir, `decisions.attempt${k}.jsonl`));
    copyIf(paths.sessionPath, join(artifactsDir, `session.attempt${k}.jsonl`));
    return paths;
  };
  const verdictOf = (orch: CortexOrchestrator): LastResolverDecision | null =>
    typeof (orch as any).getLastResolverDecision === 'function' ? ((orch as any).getLastResolverDecision() as LastResolverDecision | null) : null;
  const event = async (detail: Record<string, unknown>) => {
    try { await (opts.orchestrator as any).bankSteeringEvent?.('second_attempt', detail); } catch { /* best-effort */ }
  };

  // 1. snapshot `lift` — any failure disables the chain for this task
  const snap = new WorkspaceSnapshot({ workspace: opts.projectPath, gitDir: join(attemptsDir, 'shadow.git'), log });
  const armed = cfg.enabled && snap.init() && snap.commit('lift');
  if (cfg.enabled && !armed) log('[AttemptController] R194 second-attempt: snapshot FAILED — disabled for this task');
  else if (armed) log(`[AttemptController] R194 second-attempt: workspace snapshot lift (${snap.fileCount()} files)`);

  // 2. attempt 1 on the caller's orchestrator
  const responses: Array<OrchestratorResponse | null> = [];
  const r1 = await opts.orchestrator.sendMessage(opts.turnContent, opts.messageOptions);
  responses.push(r1);
  if (!armed) return r1;

  const records: AttemptRecord[] = [];
  const tagged = new Set<number>();
  const extraOrchs: CortexOrchestrator[] = [];
  let k = 1;
  let lastOrch: CortexOrchestrator = opts.orchestrator;
  try {
    // 3. the chain: record + decide for attempt k; open attempt k+1 while the decision says so
    for (;;) {
      const v = verdictOf(lastOrch);
      const resp = responses[k - 1] ?? null;
      const paths = bank(lastOrch, k, resp);
      const d = decideNextAttempt({ k, action: v?.action ?? null, eventRemainingFrac: v?.remainingFrac ?? null, namedPassed: v?.namedPassed ?? 0, checkPassed: v?.checkPassed ?? null, t0Ms: t0, deadlineMs: dl0, nowMs: now(), cfg });
      writeJson(join(attemptsDir, `a${k}.json`), d);
      log(`[AttemptController] R194 attempt-${k} verdict: ${JSON.stringify(d)}`);
      await event({ phase: 'decision', ...d });
      records.push({
        k, action: v?.action ?? null, remainingFrac: d.remainingFrac, namedPassed: d.namedPassed, check: 'none',
        iterations: toolCallIterationsOf(resp),
        sessionTurns: countSessionToolTurns(paths.sessionPath),
        finished: k === 1 || (!!resp && (v?.action ?? null) !== null && tagged.has(k)), rc: resp ? '0' : '1',
      });
      if (!d.go) break;
      if (k === 1) {
        if (!snap.commit('attempt1')) { log('[AttemptController] R194 commit of attempt 1 FAILED — keeping attempt 1, no further attempts'); break; }
        tagged.add(1);
      }
      const kn = k + 1;
      if (!snap.restore('lift')) { log(`[AttemptController] R194 reset to lift FAILED — stopping at attempt ${k}`); snap.restore(`attempt${k}`); break; }
      log(`[AttemptController] R194 tree reset to lift; starting attempt ${kn} (deadline ${d.nextDeadlineMs} ms)`);
      const stateDir = join(attemptsDir, `state-${kn}`);
      let orch: CortexOrchestrator | null = null;
      let rn: OrchestratorResponse | null = null;
      try {
        orch = await opts.createAttemptOrchestrator(kn, { stateDir, storageDir: join(stateDir, 'sessions'), turnDeadlineMs: d.nextDeadlineMs });
        extraOrchs.push(orch);
        rn = await orch.sendMessage(opts.turnContent, opts.messageOptions);
      } catch (e) {
        log(`[AttemptController] R194 attempt ${kn} failed: ${String((e as Error)?.message ?? e).slice(0, 300)}`);
      }
      responses.push(rn);
      if (snap.commit(`attempt${kn}`)) tagged.add(kn);
      k = kn;
      if (!orch) { // no orchestrator at all: the attempt is dead; record it and stop
        records.push({ k, action: null, remainingFrac: null, namedPassed: 0, check: 'none', iterations: null, sessionTurns: null, finished: false, rc: '1' });
        break;
      }
      lastOrch = orch;
    }
    if (k < 2) return r1;

    // 4. shipped check on every committed tree, latest first (the tree on disk IS the latest); the latest and attempt 1 are always
    //    checked, middle attempts only while the original deadline has not passed. No check file = none.
    const chk = detectShippedCheck(opts.projectPath);
    if (chk) {
      for (let j = k; j >= 1; j--) {
        const rec = records.find((r) => r.k === j);
        if (!rec || !tagged.has(j)) continue;
        if (j !== k && j !== 1 && now() >= t0 + dl0) { rec.check = 'skipped'; continue; }
        if (j !== k && !snap.restore(`attempt${j}`)) continue;
        const { result, output } = runShippedCheck(chk, opts.projectPath, cfg.checkTimeoutMs);
        rec.check = result;
        try { writeFileSync(join(attemptsDir, `chk${j}.txt`), output, 'utf-8'); writeFileSync(join(attemptsDir, `check${j}`), result + '\n', 'utf-8'); } catch { /* best-effort */ }
      }
    }

    // 5. select, restore, merge
    const sel = selectAttempt(records.sort((a, b) => a.k - b.k), chk, cfg.select);
    if (!snap.restore(`attempt${sel.pick}`)) { log(`[AttemptController] R194 restore of attempt ${sel.pick} FAILED — restoring attempt 1`); snap.restore('attempt1'); }
    writeJson(join(artifactsDir, 'second-attempt.json'), sel);
    // R245 (2026-10-10): the supervisor banks <OUT_DIR>/session.jsonl + decisions.jsonl as THE trajectory, and attempt 1's orchestrator
    // owns those files — so a pick ≠ 1 left attempt 1's trajectory in the lake (distill/curation/doctrine read the wrong attempt on every
    // library arm). Mirror the adapter chain: when an OUT_DIR is set and the pick is a later attempt, its copies become the canonical files.
    if (cfg.outDir && sel.pick !== 1) {
      for (const f of ['session', 'decisions']) {
        const src = join(artifactsDir, `${f}.attempt${sel.pick}.jsonl`);
        if (copyIf(src, join(artifactsDir, `${f}.jsonl`))) log(`[AttemptController] R194 ${f}.jsonl ← attempt ${sel.pick} (the pick)`);
      }
    }
    log(`[AttemptController] R194 selection: ${JSON.stringify(sel).slice(0, 600)}`);
    await event({ phase: 'selection', pick: sel.pick, why: sel.why, turnsSource: sel.turnsSource, shippedCheck: sel.shippedCheck, attempts: sel.attempts.map((a) => ({ k: a.k, action: a.action, check: a.check, turns: a.turns, namedPassed: a.namedPassed, finished: a.finished })) });
    const merged = mergeAttemptResponses(responses, sel);
    writeJson(join(artifactsDir, 'response.json'), merged ?? r1);
    return merged ?? r1;
  } catch (e) {
    log(`[AttemptController] R194 chain error: ${String((e as Error)?.message ?? e).slice(0, 300)} — restoring attempt 1`);
    if (tagged.has(1)) snap.restore('attempt1');
    return r1;
  } finally {
    // attempt orchestrators (k >= 2) are released here, after their verdicts and artifacts were read; attempt 1's belongs to the caller
    for (const o of extraOrchs) { try { await (o as any).cleanup?.(); } catch { /* best-effort */ } }
  }
}
