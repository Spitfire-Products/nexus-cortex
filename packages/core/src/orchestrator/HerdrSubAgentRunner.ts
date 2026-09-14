/**
 * HerdrSubAgentRunner — HB-HERDR-DELEGATES (R147, 2026-09-14).
 *
 * Runs a Task sub-agent as a herdr pane instead of a forked IPC child: the operator sees
 * every delegate live in the herdr UI and can `agent attach --takeover`; the delegate's own
 * R145 lifecycle reports (working/idle/blocked) populate herdr's status for its pane because
 * the child inherits HERDR_ENV and gets its own HERDR_PANE_ID from `pane run`.
 *
 * The in-process/IPC path (SubAgentProcessManager) stays the default. Runtime selection:
 *   CORTEX_SUBAGENT_RUNTIME=auto|process|herdr (auto = herdr when HERDR_ENV=1, the herdr
 *   terminal backend resolves AND the parent auto-approves tools — a pane child has no IPC
 *   approval channel, so it runs auto-approved; explicit lever/`runtime` input skip that guard).
 *   Task input `runtime: "process"|"herdr"` overrides per dispatch.
 *
 * herdr 0.9.0 wire shapes (verified live on session `bench` 2026-09-14):
 *   pane split <parent> --direction down --no-focus --cwd P               -> JSON .result.pane.pane_id (env rides the task file, not --env)
 *   pane rename <pane> <name>                                              -> JSON ok (cosmetic)
 *   pane run <pane> <command>                                              -> (no output)
 *   agent wait <pane> --until idle --until done --timeout MS               -> JSON .result.agent.agent_status
 *       before the child reports: .error.code == "agent_not_found" (rc 1) -- NOT an error for us
 *       slice elapsed:            .error.code == "timeout" (rc 1)
 *   agent rename <pane> <name>                                             -> JSON (needs a seen agent)
 *   pane read <pane> --source recent-unwrapped --lines N                   -> plain text
 *   pane send-keys <pane> C-c                                              -> (no output)
 *   pane close <pane>                                                      -> JSON .result.type == "ok"
 * `cortex` is not a recognized `agent start --kind`, so the delegate is started with `pane run`
 * and addressed by pane id throughout. A reported idle renders as `done` until seen: both count.
 *
 * Completion evidence (any one is enough): result.json written by the child (agent-mode
 * --result-file), `agent wait` reporting idle/done, or the shell exit sentinel printed after
 * the child exits (crash / nonzero exit -> status error). The runner's hard deadline is
 * timeoutMs + a grace so the child's own R133 turn-deadline result (status timeout, partial
 * response, Files Modified) is preferred over the runner's C-c.
 *
 * Env parity with the IPC child (which inherits the parent's process.env): the pane shell's
 * env comes from the herdr SERVER, so the parent's env snapshot + the overrides ride the 0600
 * task file (`env`), never `pane split --env` / the command line (ps-visible secrets). HERDR_*
 * is excluded so the child keeps its own pane identity (HERDR_PANE_ID, verified inherited).
 *
 * Final status: the child's R145 reporter throttles (250 ms coalescing) and the process exits
 * ~100 ms after completion, so its last `idle` can be lost (live: pane stuck at `working`).
 * The runner therefore reports the terminal state for the pane itself once the result is in.
 */

import { spawn } from 'child_process';
import * as crypto from 'crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import type { AgentDefinition, SubAgentResult } from './SubAgentTypes.js';
import { resolveHerdrReporting, sanitizeHerdrAgentName, sanitizeHerdrSummary, HERDR_SOURCE, HERDR_DISPLAY_SOURCE } from './herdrReporter.js';

export type SubAgentRuntime = 'process' | 'herdr';
export type SubAgentRuntimeLever = 'auto' | SubAgentRuntime;

export interface DelegateExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}
export type DelegateExecFn = (
  bin: string,
  args: string[],
  opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
) => Promise<DelegateExecResult>;

/** One `agent wait` slice; the loop re-arms until the deadline. */
export const HERDR_WAIT_SLICE_MS = 2000;
/** Runner deadline = timeoutMs + this, so the child's own deadline result wins when it converges. */
export const HERDR_DELEGATE_GRACE_MS = 15_000;
/** After idle/done is seen, how long to wait for result.json to land (the child writes then exits). */
export const HERDR_RESULT_SETTLE_MS = 5000;
export const HERDR_TRANSCRIPT_LINES = 200;
const EXEC_GRACE_MS = 5000;
const SETTLE_POLL_MS = 200;

export function readSubAgentRuntimeLever(env: NodeJS.ProcessEnv = process.env): SubAgentRuntimeLever {
  const raw = (env.CORTEX_SUBAGENT_RUNTIME || '').trim().toLowerCase();
  if (raw === 'process' || raw === 'herdr') return raw;
  return 'auto';
}

/** Default keep=1: the operator can inspect / take over the delegate pane after it finishes. */
export function readKeepDelegatePanes(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.CORTEX_HERDR_KEEP_DELEGATE_PANES || '').trim().toLowerCase();
  return !(raw === '0' || raw === 'false');
}

export interface ResolveSubAgentRuntimeInput {
  lever: SubAgentRuntimeLever;
  /** Task input `runtime` (per-dispatch override); anything but process|herdr is ignored. */
  requested?: unknown;
  /** HERDR_ENV=1 + binary + socket reachable (the caller probes the terminal backend). */
  herdrAvailable: boolean;
  /** Parent approval mode auto-approves tools (a pane child has no IPC approval channel). */
  parentAutoApprove: boolean;
  warn?: (line: string) => void;
}

export function resolveSubAgentRuntime(input: ResolveSubAgentRuntimeInput): { runtime: SubAgentRuntime; reason: string } {
  const warn = input.warn ?? ((line: string) => console.warn(line));
  const requested = typeof input.requested === 'string' ? input.requested.trim().toLowerCase() : '';
  const explicit: SubAgentRuntime | undefined =
    requested === 'process' || requested === 'herdr' ? requested
    : input.lever === 'process' || input.lever === 'herdr' ? input.lever
    : undefined;
  const via = requested === 'process' || requested === 'herdr' ? 'Task runtime input' : 'CORTEX_SUBAGENT_RUNTIME';

  if (explicit === 'process') return { runtime: 'process', reason: `${via}=process` };
  if (explicit === 'herdr') {
    if (input.herdrAvailable) return { runtime: 'herdr', reason: `${via}=herdr` };
    warn(`[WARN] ${via}=herdr but herdr is unavailable (needs HERDR_ENV=1 + reachable herdr socket); running the sub-agent as a child process`);
    return { runtime: 'process', reason: `${via}=herdr but unavailable` };
  }
  if (!input.herdrAvailable) return { runtime: 'process', reason: 'auto: herdr unavailable' };
  if (!input.parentAutoApprove) return { runtime: 'process', reason: 'auto: parent is not auto-approving (pane delegates have no approval channel)' };
  return { runtime: 'herdr', reason: 'auto: herdr available' };
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The parent's own agent-mode entry (core/dist/orchestrator -> cli/dist/agent-mode.js), else argv-relative. */
export function resolveAgentModulePath(): string {
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const candidate = join(thisDir, '..', '..', '..', 'cli', 'dist', 'agent-mode.js');
    if (existsSync(candidate)) return candidate;
  } catch {
    /* fall through */
  }
  const argv1 = process.argv[1] || '';
  if (argv1) {
    const sibling = join(dirname(argv1), 'agent-mode.js');
    if (existsSync(sibling)) return sibling;
  }
  return join(process.cwd(), 'packages', 'cli', 'dist', 'agent-mode.js');
}

export const defaultDelegateExec: DelegateExecFn = (bin, args, opts) =>
  new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(bin, args, { env: opts?.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = opts?.timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          try { child.kill('SIGKILL'); } catch { /* gone */ }
          reject(new Error(`${bin} ${args.slice(0, 2).join(' ')} did not return within ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : undefined;
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (e) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); reject(e); });
    child.on('close', (code) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); resolve({ stdout, stderr, code }); });
  });

interface Envelope {
  result?: any;
  error?: { code?: string; message?: string };
}

function parseEnvelope(res: DelegateExecResult, what: string): Envelope {
  for (const t of [res.stdout.trim(), res.stderr.trim()]) {
    if (t.startsWith('{')) {
      try { return JSON.parse(t) as Envelope; } catch { /* next */ }
    }
  }
  if (res.code !== 0) {
    throw new Error(`herdr ${what} failed (exit ${res.code}): ${(res.stderr || res.stdout).trim() || 'no output'}`);
  }
  return { result: res.stdout.trim() };
}

/** The JSON the child reads (agent-mode --task-file); mirrors IPCStartMessage.payload + permissionMode. */
export interface DelegateTaskFile {
  agentId: string;
  agentDefinition: AgentDefinition;
  taskPrompt: string;
  modelId: string;
  projectPath: string;
  timeoutMs: number;
  maxTurns: number;
  debug?: boolean;
  /** Pane delegates have no IPC approval channel; auto is the only mode that can complete unattended. */
  permissionMode: 'auto' | 'interactive';
  /** Parent env snapshot + overrides, applied by agent-mode before the orchestrator boots (HERDR_* excluded). */
  env?: Record<string, string>;
}

export interface HerdrDelegateOptions {
  agentDef: AgentDefinition;
  taskPrompt: string;
  /** herdr agent/pane label (sanitized to [a-z][a-z0-9_-]{0,31}). */
  name: string;
  cwd: string;
  envOverrides?: Record<string, string>;
  timeoutMs: number;
  modelOverride?: string;
  agentId?: string;
  maxTurns?: number;
  debug?: boolean;
  /** Test/explicit seams. */
  exec?: DelegateExecFn;
  env?: NodeJS.ProcessEnv;
  bin?: string;
  parentPaneId?: string;
  /** Pass `--session <name>` (only needed when the parent is NOT itself inside a herdr pane). */
  session?: string;
  nodeBin?: string;
  agentModulePath?: string;
  tmpRoot?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  waitSliceMs?: number;
  warn?: (line: string) => void;
}

export interface HerdrDelegateResult extends SubAgentResult {
  runtime: 'herdr';
  paneId: string;
  transcriptTail: string;
}

function reviveResult(raw: string): SubAgentResult {
  const parsed = JSON.parse(raw) as SubAgentResult;
  parsed.startTime = new Date(parsed.startTime as unknown as string);
  parsed.endTime = new Date(parsed.endTime as unknown as string);
  return parsed;
}

function stripSentinelLines(text: string, token: string): string {
  return text.split('\n').filter((l) => !l.includes(`__CORTEX_DELEGATE_EXIT_${token}_`)).join('\n');
}

export async function runDelegateInHerdr(opts: HerdrDelegateOptions): Promise<HerdrDelegateResult> {
  const env = opts.env ?? process.env;
  const exec = opts.exec ?? defaultDelegateExec;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const warn = opts.warn ?? ((line: string) => console.warn(line));
  const sliceMs = Math.max(250, opts.waitSliceMs ?? HERDR_WAIT_SLICE_MS);

  let bin = opts.bin;
  let parentPaneId = opts.parentPaneId;
  if (!bin || !parentPaneId) {
    const res = resolveHerdrReporting({ ...env, CORTEX_HERDR_REPORTING: '' });
    if (!res.enabled || !res.bin || !res.paneId) throw new Error(`herdr delegate unavailable: ${res.reason}`);
    bin = bin ?? res.bin;
    parentPaneId = parentPaneId ?? res.paneId;
  }
  const sessionArgs = opts.session ? ['--session', opts.session] : [];
  const call = (args: string[], timeoutMs = EXEC_GRACE_MS) => exec(bin!, [...sessionArgs, ...args], { timeoutMs, env });

  const name = sanitizeHerdrAgentName(opts.name);
  const agentId = opts.agentId ?? `${opts.agentDef.name}-${crypto.randomBytes(3).toString('hex')}`;
  const modelId = opts.modelOverride ?? opts.agentDef.model;
  const startTime = new Date(now());
  const keepPane = readKeepDelegatePanes(env);

  // Task + result files (the prompt never rides the command line).
  const tmpRoot = opts.tmpRoot ?? join(tmpdir(), 'cortex-delegates');
  mkdirSync(tmpRoot, { recursive: true });
  const dir = mkdtempSync(join(tmpRoot, `${name}-`));
  const taskFile = join(dir, 'task.json');
  const resultFile = join(dir, 'result.json');
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string' && !k.startsWith('HERDR_')) childEnv[k] = v;
  }
  Object.assign(childEnv, {
    CORTEX_AGENT_MODE: 'true',
    CORTEX_AGENT_ID: agentId,
    CORTEX_HERDR_AGENT_NAME: name,
    CORTEX_TURN_DEADLINE_MS: String(opts.timeoutMs),
  }, opts.envOverrides ?? {});
  const task: DelegateTaskFile = {
    agentId,
    agentDefinition: opts.agentDef,
    taskPrompt: opts.taskPrompt,
    modelId,
    projectPath: opts.cwd,
    timeoutMs: opts.timeoutMs,
    maxTurns: opts.maxTurns ?? 50,
    debug: opts.debug,
    permissionMode: 'auto',
    env: childEnv,
  };
  writeFileSync(taskFile, JSON.stringify(task), { encoding: 'utf-8', mode: 0o600 });
  try { chmodSync(taskFile, 0o600); } catch { /* best effort */ }

  // 1. Sibling pane under the parent, down, no focus (env rides the task file, not argv).
  const split = parseEnvelope(await call(['pane', 'split', parentPaneId!, '--direction', 'down', '--no-focus', '--cwd', opts.cwd]), 'pane split');
  if (split.error) throw new Error(`herdr pane split failed: ${split.error.message ?? split.error.code}`);
  const paneId: string | undefined = split.result?.pane?.pane_id;
  if (!paneId) throw new Error('herdr pane split returned no pane_id');

  try { await call(['pane', 'rename', paneId, name]); } catch { /* cosmetic */ }

  // 2. Run the parent's own agent-mode entry in the pane with an exit sentinel.
  const token = crypto.randomBytes(4).toString('hex');
  const nodeBin = opts.nodeBin ?? process.execPath;
  const agentModule = opts.agentModulePath ?? resolveAgentModulePath();
  const command =
    `${shellQuote(nodeBin)} ${shellQuote(agentModule)} --task-file ${shellQuote(taskFile)} --result-file ${shellQuote(resultFile)}` +
    `; printf '__CORTEX_DELEGATE_EXIT_${token}_%s__\\n' $?`;
  parseEnvelope(await call(['pane', 'run', paneId, command]), 'pane run');

  // 3. Wait: agent wait slices + result.json + exit sentinel, until the deadline.
  const deadline = now() + opts.timeoutMs + HERDR_DELEGATE_GRACE_MS;
  const exitRe = new RegExp(`__CORTEX_DELEGATE_EXIT_${token}_(\\d+)__`);
  let agentSeen = false;
  let idleSeen = false;
  let exitCode: number | null = null;
  let timedOut = false;

  const readPane = async (): Promise<string> => {
    const res = await call(['pane', 'read', paneId, '--source', 'recent-unwrapped', '--lines', String(HERDR_TRANSCRIPT_LINES)]);
    if (res.code !== 0) parseEnvelope(res, 'pane read');
    return res.stdout;
  };

  for (;;) {
    if (existsSync(resultFile)) break;
    if (now() >= deadline) { timedOut = true; break; }
    const remaining = deadline - now();
    const slice = Math.max(250, Math.min(sliceMs, remaining));
    const waited = parseEnvelope(
      await call(['agent', 'wait', paneId, '--until', 'idle', '--until', 'done', '--timeout', String(slice)], slice + EXEC_GRACE_MS),
      'agent wait',
    );
    if (!waited.error) {
      agentSeen = true;
      idleSeen = true;
      break;
    }
    const code = waited.error.code;
    if (code === 'timeout') { agentSeen = true; continue; }
    if (code === 'agent_not_found') {
      // Not reported yet (starting) or already gone (exited): the exit sentinel disambiguates.
      const m = (await readPane()).match(exitRe);
      if (m) { exitCode = Number(m[1]); break; }
      await sleep(Math.min(slice, 1000));
      continue;
    }
    throw new Error(`herdr agent wait failed: ${waited.error.message ?? code}`);
  }

  // Idle seen: give the child a moment to flush result.json and exit.
  if (idleSeen && !existsSync(resultFile)) {
    const settleUntil = now() + HERDR_RESULT_SETTLE_MS;
    while (!existsSync(resultFile) && now() < settleUntil) await sleep(SETTLE_POLL_MS);
  }
  if (timedOut) {
    try { await call(['pane', 'send-keys', paneId, 'C-c']); } catch (e) { warn(`[WARN] herdr delegate ${name}: C-c failed: ${(e as Error).message}`); }
  }
  if (agentSeen) {
    try { await call(['agent', 'rename', paneId, name]); } catch { /* cosmetic */ }
  }

  let transcriptTail = '';
  try { transcriptTail = stripSentinelLines(await readPane(), token); } catch (e) { warn(`[WARN] herdr delegate ${name}: pane read failed: ${(e as Error).message}`); }

  // 4. Assemble the SubAgentResult.
  let result: SubAgentResult;
  if (existsSync(resultFile)) {
    try {
      result = reviveResult(readFileSync(resultFile, 'utf-8'));
    } catch (e) {
      result = errorResult(agentId, opts.agentDef.name, modelId, startTime, now, `result.json unreadable: ${(e as Error).message}`, transcriptTail);
    }
  } else if (timedOut) {
    result = {
      ...errorResult(agentId, opts.agentDef.name, modelId, startTime, now, `delegate did not finish within ${opts.timeoutMs}ms (C-c sent to pane ${paneId})`, transcriptTail),
      status: 'timeout',
      summary: `Agent "${opts.agentDef.name}" timeout in herdr pane ${paneId}; partial transcript attached`,
    };
  } else {
    result = errorResult(
      agentId, opts.agentDef.name, modelId, startTime, now,
      exitCode !== null ? `delegate process exited with code ${exitCode} before writing its result` : 'delegate ended without a result',
      transcriptTail,
    );
  }

  // 5. Terminal state for the pane: the child's throttled last report can die with its process.
  try {
    await call(['pane', 'report-agent', paneId, '--source', HERDR_SOURCE, '--agent', name, '--state', 'idle']);
    await call(['pane', 'report-metadata', paneId, '--source', HERDR_DISPLAY_SOURCE, '--token', `summary=${sanitizeHerdrSummary(`delegate:${result.status}`)}`]);
  } catch { /* cosmetic */ }

  // 6. Pane hygiene: keep by default (operator inspection); close + scrub when asked.
  if (!keepPane) {
    try { await call(['pane', 'close', paneId]); } catch (e) { warn(`[WARN] herdr delegate ${name}: pane close failed: ${(e as Error).message}`); }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  return { ...result, runtime: 'herdr', paneId, transcriptTail };
}

function errorResult(
  agentId: string,
  agentName: string,
  model: string,
  startTime: Date,
  now: () => number,
  message: string,
  transcriptTail: string,
): SubAgentResult {
  const endTime = new Date(now());
  return {
    agentId,
    agentName,
    model,
    startTime,
    endTime,
    durationMs: endTime.getTime() - startTime.getTime(),
    turnCount: 0,
    status: 'error',
    summary: `Agent "${agentName}" error: ${message}`,
    fullResponse: transcriptTail,
    toolsUsed: [],
    filesRead: [],
    filesModified: [],
    cost: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, cacheHits: 0 },
    error: { message, type: 'HerdrDelegateError' },
  };
}
