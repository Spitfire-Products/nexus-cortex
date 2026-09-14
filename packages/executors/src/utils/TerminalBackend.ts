/**
 * TerminalBackend — HB-HERDR-TERMINAL-BACKEND (R146, 2026-09-14).
 *
 * One seam under ShellTool.persistentSession / TmuxSessionTool / CreateArtifactTool
 * persistent mode. Resolution order (cached per process):
 *
 *   herdr    HERDR_ENV=1 + binary resolvable (core resolveHerdrReporting order:
 *            CORTEX_HERDR_BIN -> HERDR_BIN_PATH -> PATH) + `herdr pane list` succeeds
 *   tmux     TmuxManager.isAvailable()
 *   detached the R134 BackgroundProcessRegistry path (no real session semantics)
 *
 * Lever: CORTEX_TERMINAL_BACKEND=auto|herdr|tmux|detached (auto default). An explicit
 * tmux/detached skips the higher-priority backends; an explicit herdr that cannot be
 * satisfied warns once and falls through (never a hard error on the request path).
 *
 * herdr wire shapes (herdr 0.9.0, verified live on session `bench` 2026-09-14):
 *   pane split <parent> --direction down --no-focus [--cwd P] [--env K=V]  -> JSON .result.pane.pane_id
 *   pane run <pane> <command>                                              -> (no output)
 *   pane send-text <pane> <text>    bracketed paste, no Enter              -> (no output)
 *   pane send-keys <pane> <key>...                                         -> (no output)
 *   pane read <pane> --source recent-unwrapped --lines N                   -> plain text
 *   pane wait-output <pane> --match T|--regex R --timeout MS               -> JSON .result.matched_line + .result.read.text
 *                                                                             timeout: JSON .error.code == "timeout", rc 1
 *   pane close <pane>                                                      -> JSON .result.type == "ok"
 * Inside a herdr pane the CLI targets its own server through HERDR_SOCKET_PATH /
 * HERDR_SESSION (both verified), so no --session flag is passed; the child inherits env.
 *
 * Terminus lessons inherited (HB-TERMINUS-LESSONS): R139/R142 wait primitive =
 * `pane wait-output` (no poll loop); R140 oversize/multi-line input = bracketed
 * paste via send-text; R141 capture cap = --lines + 10 KB middle-omitted truncation.
 */

import { spawn } from 'child_process';
import * as crypto from 'crypto';
import { resolveHerdrReporting } from '@nexus-cortex/core';
import { TmuxManager } from './TmuxManager.js';
import { BackgroundProcessRegistry } from '../implementations/execution/BackgroundProcessRegistry.js';
import { stripAnsi } from './TextUtils.js';

export type TerminalBackendKind = 'herdr' | 'tmux' | 'detached';

export interface TerminalSessionOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Human label (herdr: pane rename + alias; tmux: the session id). */
  label?: string;
}

export interface TerminalRunOptions {
  /** Wait for the completion sentinel (default true). */
  block?: boolean;
  /** Hard cap for the blocking wait (default 120000). Never exceeded. */
  timeoutMs?: number;
  /**
   * R142: an extra wait target for BLOCKING runs — the wait ends at the sentinel OR when
   * the session output (after the command echo) matches; `waitMatched` reports the latter.
   */
  waitFor?: { match?: string; regex?: string };
}

export interface TerminalRunResult {
  output: string;
  completed: boolean;
  timedOut?: boolean;
  exitCode?: number | null;
  /** R142: the run returned because opts.waitFor matched (command may still be running). */
  waitMatched?: boolean;
}

export interface TerminalReadOptions {
  lines?: number;
  history?: boolean;
}

export interface TerminalWaitOptions {
  match?: string;
  regex?: string;
  timeoutMs: number;
}

export interface TerminalBackend {
  readonly kind: TerminalBackendKind;
  isAvailable(): Promise<boolean>;
  createSession(opts: TerminalSessionOptions): Promise<{ id: string }>;
  run(id: string, command: string, opts?: TerminalRunOptions): Promise<TerminalRunResult>;
  sendText(id: string, text: string): Promise<void>;
  sendKeys(id: string, keys: string[]): Promise<void>;
  read(id: string, opts?: TerminalReadOptions): Promise<string>;
  waitOutput(id: string, opts: TerminalWaitOptions): Promise<{ matched: boolean; output: string }>;
  kill(id: string): Promise<void>;
  list(): Promise<string[]>;
  /** One-line description for logs. */
  describe(): string;
  /** Optional: map a createSession label to its session id (herdr). */
  resolveId?(idOrLabel: string): string;
}

export interface BackendExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}
export type BackendExecFn = (
  bin: string,
  args: string[],
  opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
) => Promise<BackendExecResult>;

export const DEFAULT_RUN_TIMEOUT_MS = 120000;
/** R141: capture cap (10 KB, middle omitted). */
export const HERDR_READ_CAP_CHARS = 10 * 1024;
export const HERDR_DEFAULT_READ_LINES = 200;
export const HERDR_HISTORY_READ_LINES = 3000;
/** R140: above this (or any newline) the command goes through bracketed paste. */
export const HERDR_PASTE_THRESHOLD_CHARS = 4096;
const TMUX_POLL_INTERVAL_MS = 400;
const EXEC_GRACE_MS = 5000;

/** Keep head + tail, mark the omitted middle (Terminus _limit_output_length). */
export function truncateMiddle(text: string, maxChars: number = HERDR_READ_CAP_CHARS): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  const omitted = text.length - half * 2;
  return `${text.slice(0, half)}\n... [${omitted} chars omitted] ...\n${text.slice(text.length - half)}`;
}

/** Default exec: argv spawn (no shell quoting), inherits env, hard-killed after timeoutMs. */
export const defaultBackendExec: BackendExecFn = (bin, args, opts) =>
  new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(bin, args, { env: opts?.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = opts?.timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
          reject(new Error(`${bin} ${args.slice(0, 2).join(' ')} did not return within ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : undefined;
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });

interface HerdrEnvelope {
  id?: string;
  result?: any;
  error?: { code?: string; message?: string };
}

function parseEnvelope(res: BackendExecResult, what: string): HerdrEnvelope {
  // Result envelopes arrive on stdout; ERROR envelopes (e.g. wait-output timeout, rc 1)
  // arrive on stderr (verified live, herdr 0.9.0). Accept either.
  for (const text of [res.stdout.trim(), res.stderr.trim()]) {
    if (text.startsWith('{')) {
      try {
        return JSON.parse(text) as HerdrEnvelope;
      } catch {
        /* fall through */
      }
    }
  }
  const text = res.stdout.trim();
  if (res.code !== 0) {
    throw new Error(`herdr ${what} failed (exit ${res.code}): ${(res.stderr || res.stdout).trim() || 'no output'}`);
  }
  return { result: text };
}

function sentinelRegex(token: string): string {
  return `__CORTEX_DONE_${token}_(\\d+)__`;
}

/** R142: the regex source for a TerminalRunOptions.waitFor target (match = escaped literal). */
export function waitForRegexSource(waitFor: { match?: string; regex?: string } | undefined): string | null {
  if (!waitFor) return null;
  if (waitFor.regex) return waitFor.regex;
  if (waitFor.match) return waitFor.match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return null;
}

/**
 * R142: the part of a pane capture produced AFTER the last echoed command line carrying the
 * sentinel token — so stale screen text never satisfies a waitFor target.
 */
export function outputAfterCommandEcho(capture: string, token: string): string {
  const idx = capture.lastIndexOf(`__CORTEX_DONE_${token}_%`);
  if (idx < 0) return capture;
  const eol = capture.indexOf('\n', idx);
  return eol < 0 ? '' : capture.slice(eol + 1);
}

/** Drop every line carrying the sentinel token (echoed command line + printed marker). */
export function stripSentinel(output: string, token: string): string {
  return output
    .split('\n')
    .filter((line) => !line.includes(`__CORTEX_DONE_${token}_`))
    .join('\n');
}

export interface HerdrTerminalBackendOptions {
  bin: string;
  /** The host pane (HERDR_PANE_ID) new sessions are split from. */
  parentPaneId: string;
  exec?: BackendExecFn;
  env?: NodeJS.ProcessEnv;
}

/**
 * herdr backend: one herdr pane per session, split DOWN from the harness pane with
 * --no-focus so the operator keeps their view; panes survive client detach and are
 * visible / takeover-able in the herdr UI.
 */
export class HerdrTerminalBackend implements TerminalBackend {
  readonly kind = 'herdr' as const;
  private readonly bin: string;
  private readonly parentPaneId: string;
  private readonly exec: BackendExecFn;
  private readonly env: NodeJS.ProcessEnv;
  /** Pane ids this backend created (list() contract). */
  private readonly panes = new Set<string>();
  /** label -> pane id */
  private readonly aliases = new Map<string, string>();

  constructor(opts: HerdrTerminalBackendOptions) {
    this.bin = opts.bin;
    this.parentPaneId = opts.parentPaneId;
    this.exec = opts.exec ?? defaultBackendExec;
    this.env = opts.env ?? process.env;
  }

  describe(): string {
    return `herdr pane backend (bin ${this.bin}, host pane ${this.parentPaneId})`;
  }

  /** Accept a pane id or a label registered by createSession. */
  resolveId(idOrLabel: string): string {
    return this.aliases.get(idOrLabel) ?? idOrLabel;
  }

  private async call(args: string[], timeoutMs?: number): Promise<BackendExecResult> {
    return this.exec(this.bin, args, { timeoutMs, env: this.env });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const env = parseEnvelope(await this.call(['pane', 'list'], EXEC_GRACE_MS), 'pane list');
      return !env.error && Array.isArray(env.result?.panes);
    } catch {
      return false;
    }
  }

  async createSession(opts: TerminalSessionOptions): Promise<{ id: string }> {
    const args = ['pane', 'split', this.parentPaneId, '--direction', 'down', '--no-focus'];
    if (opts.cwd) args.push('--cwd', opts.cwd);
    for (const [k, v] of Object.entries(opts.env ?? {})) args.push('--env', `${k}=${v}`);
    const env = parseEnvelope(await this.call(args, EXEC_GRACE_MS), 'pane split');
    if (env.error) throw new Error(`herdr pane split failed: ${env.error.message ?? env.error.code}`);
    const id: string | undefined = env.result?.pane?.pane_id;
    if (!id) throw new Error('herdr pane split returned no pane_id');
    this.panes.add(id);
    if (opts.label) {
      this.aliases.set(opts.label, id);
      try { await this.call(['pane', 'rename', id, opts.label], EXEC_GRACE_MS); } catch { /* cosmetic */ }
    }
    return { id };
  }

  /**
   * Submit a command. Blocking runs append a printf sentinel carrying $? and wait for it
   * with `pane wait-output --regex --timeout` (R139/R142: the wait primitive, not a poll
   * loop). Multi-line or oversize commands go through bracketed paste (R140).
   */
  async run(idOrLabel: string, command: string, opts: TerminalRunOptions = {}): Promise<TerminalRunResult> {
    const id = this.resolveId(idOrLabel);
    const block = opts.block !== false;
    const timeoutMs = Math.max(1, Math.floor(opts.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS));
    const token = crypto.randomBytes(4).toString('hex');
    const marker = `printf '\\n__CORTEX_DONE_${token}_%s__\\n' $?`;
    const multiline = command.includes('\n');
    const full = multiline ? `${command}\n${marker}` : `${command}; ${marker}`;

    if (multiline || full.length > HERDR_PASTE_THRESHOLD_CHARS) {
      await this.sendText(id, full);
      await this.sendKeys(id, ['Enter']);
    } else {
      const res = await this.call(['pane', 'run', id, full], EXEC_GRACE_MS);
      parseEnvelope(res, 'pane run');
    }

    if (!block) {
      return { output: '', completed: false, exitCode: null };
    }

    // R142: one wait-output call watches the sentinel AND the caller's waitFor target.
    // `pane wait-output` matches the whole screen, so a hit on the ECHOED command line
    // (verified live: `echo READY 9090` matched /READY \d+/ at 0.0s) is re-checked against
    // the text AFTER the echo and re-waited (bounded poll) until it is real or time is up.
    const extra = waitForRegexSource(opts.waitFor);
    const extraRe = extra ? new RegExp(extra) : null;
    const regex = extra ? `(?:${sentinelRegex(token)})|(?:${extra})` : sentinelRegex(token);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = Math.max(1, deadline - Date.now());
      const waited = await this.waitOutputRaw(id, { regex, timeoutMs: remaining });
      if (!waited.matched) {
        const output = await this.read(id);
        return { output: stripSentinel(output, token), completed: false, timedOut: true, exitCode: null };
      }
      const m = waited.matchedLine.match(new RegExp(sentinelRegex(token)));
      if (m) {
        const output = await this.read(id);
        return { output: stripSentinel(output, token), completed: true, exitCode: Number(m[1]) };
      }
      const raw = await this.readRaw(id, { history: true });
      if (!extraRe || extraRe.test(outputAfterCommandEcho(raw, token))) {
        return { output: truncateMiddle(stripSentinel(raw, token)), completed: false, exitCode: null, waitMatched: true };
      }
      if (Date.now() >= deadline) {
        return { output: truncateMiddle(stripSentinel(raw, token)), completed: false, timedOut: true, exitCode: null };
      }
      await new Promise((r) => setTimeout(r, TMUX_POLL_INTERVAL_MS));
    }
  }

  async sendText(idOrLabel: string, text: string): Promise<void> {
    parseEnvelope(await this.call(['pane', 'send-text', this.resolveId(idOrLabel), text], EXEC_GRACE_MS), 'pane send-text');
  }

  async sendKeys(idOrLabel: string, keys: string[]): Promise<void> {
    parseEnvelope(await this.call(['pane', 'send-keys', this.resolveId(idOrLabel), ...keys], EXEC_GRACE_MS), 'pane send-keys');
  }

  /** `pane read --source recent-unwrapped --lines N`, ANSI-stripped, uncapped. */
  private async readRaw(idOrLabel: string, opts: TerminalReadOptions = {}): Promise<string> {
    const lines = opts.lines ?? (opts.history ? HERDR_HISTORY_READ_LINES : HERDR_DEFAULT_READ_LINES);
    const res = await this.call(
      ['pane', 'read', this.resolveId(idOrLabel), '--source', 'recent-unwrapped', '--lines', String(lines)],
      EXEC_GRACE_MS,
    );
    if (res.code !== 0) parseEnvelope(res, 'pane read');
    return stripAnsi(res.stdout);
  }

  /** `pane read`, capped at 10 KB middle-omitted (R141). */
  async read(idOrLabel: string, opts: TerminalReadOptions = {}): Promise<string> {
    return truncateMiddle(await this.readRaw(idOrLabel, opts));
  }

  private async waitOutputRaw(
    id: string,
    opts: TerminalWaitOptions,
  ): Promise<{ matched: boolean; matchedLine: string; text: string }> {
    const args = ['pane', 'wait-output', id];
    if (opts.regex) args.push('--regex', opts.regex);
    else if (opts.match) args.push('--match', opts.match);
    else throw new Error('waitOutput needs match or regex');
    args.push('--timeout', String(Math.max(1, Math.floor(opts.timeoutMs))));
    const res = await this.call(args, opts.timeoutMs + EXEC_GRACE_MS);
    const env = parseEnvelope(res, 'pane wait-output');
    if (env.error) {
      if (env.error.code === 'timeout') return { matched: false, matchedLine: '', text: '' };
      throw new Error(`herdr pane wait-output failed: ${env.error.message ?? env.error.code}`);
    }
    return {
      matched: true,
      matchedLine: String(env.result?.matched_line ?? ''),
      text: String(env.result?.read?.text ?? ''),
    };
  }

  async waitOutput(idOrLabel: string, opts: TerminalWaitOptions): Promise<{ matched: boolean; output: string }> {
    const id = this.resolveId(idOrLabel);
    const raw = await this.waitOutputRaw(id, opts);
    if (raw.matched) return { matched: true, output: truncateMiddle(stripAnsi(raw.text)) };
    return { matched: false, output: await this.read(id) };
  }

  async kill(idOrLabel: string): Promise<void> {
    const id = this.resolveId(idOrLabel);
    const env = parseEnvelope(await this.call(['pane', 'close', id], EXEC_GRACE_MS), 'pane close');
    if (env.error) throw new Error(`herdr pane close failed: ${env.error.message ?? env.error.code}`);
    this.panes.delete(id);
    for (const [label, pid] of this.aliases) if (pid === id) this.aliases.delete(label);
  }

  async list(): Promise<string[]> {
    return Array.from(this.panes);
  }
}

/**
 * Thin wrapper over TmuxManager — the existing sentinel-poll behavior is preserved.
 * R140: multi-line / oversize commands reach the session through TmuxManager's
 * load-buffer/paste-buffer path (sentinel on its own line so a heredoc terminator
 * is never glued to `; printf`); sendText is Enter-less, sendKeys sends key names.
 */
export class TmuxTerminalBackend implements TerminalBackend {
  readonly kind = 'tmux' as const;
  constructor(private readonly tmux: TmuxManager = TmuxManager.getInstance()) {}

  describe(): string {
    return 'tmux backend (TmuxManager)';
  }

  isAvailable(): Promise<boolean> {
    return this.tmux.isAvailable();
  }

  async createSession(opts: TerminalSessionOptions): Promise<{ id: string }> {
    const id = await this.tmux.createSession(opts.label, opts.cwd, opts.env);
    return { id };
  }

  async run(id: string, command: string, opts: TerminalRunOptions = {}): Promise<TerminalRunResult> {
    const block = opts.block !== false;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    const token = crypto.randomBytes(4).toString('hex');
    // TmuxManager.sendKeys delivers argv-verbatim (R140), so `$?` needs no host-shell escaping.
    const marker = `printf '__CORTEX_DONE_${token}_%d__\\n' $?`;
    await this.tmux.sendKeys(id, command.includes('\n') ? `${command}\n${marker}` : `${command}; ${marker}`);
    if (!block) return { output: '', completed: false, exitCode: null };
    const deadline = Date.now() + timeoutMs;
    const re = new RegExp(sentinelRegex(token));
    const extraSrc = waitForRegexSource(opts.waitFor);
    const extra = extraSrc ? new RegExp(extraSrc) : null;
    let output = '';
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, TMUX_POLL_INTERVAL_MS));
      output = await this.tmux.capturePane(id);
      const m = output.match(re);
      if (m) return { output: stripSentinel(output, token), completed: true, exitCode: Number(m[1]) };
      // R142: only text after the echoed command line counts toward waitFor.
      if (extra && extra.test(outputAfterCommandEcho(output, token))) {
        return { output: stripSentinel(output, token), completed: false, exitCode: null, waitMatched: true };
      }
    }
    return { output: stripSentinel(output, token), completed: false, timedOut: true, exitCode: null };
  }

  /** Enter-less text (R140: bracketed paste via load-buffer/paste-buffer when multi-line or oversize). */
  sendText(id: string, text: string): Promise<void> {
    return this.tmux.sendKeys(id, text, { enter: false });
  }

  sendKeys(id: string, keys: string[]): Promise<void> {
    return this.tmux.sendRawKeys(id, keys);
  }

  read(id: string, opts: TerminalReadOptions = {}): Promise<string> {
    return this.tmux.capturePane(id, opts.history ? -HERDR_HISTORY_READ_LINES : opts.lines ? -opts.lines : undefined);
  }

  async waitOutput(id: string, opts: TerminalWaitOptions): Promise<{ matched: boolean; output: string }> {
    const deadline = Date.now() + opts.timeoutMs;
    const re = opts.regex ? new RegExp(opts.regex) : null;
    let output = '';
    for (;;) {
      output = await this.tmux.capturePane(id);
      if ((re && re.test(output)) || (opts.match && output.includes(opts.match))) return { matched: true, output };
      if (Date.now() >= deadline) return { matched: false, output };
      await new Promise((r) => setTimeout(r, TMUX_POLL_INTERVAL_MS));
    }
  }

  kill(id: string): Promise<void> {
    return this.tmux.killSession(id);
  }

  list(): Promise<string[]> {
    return this.tmux.listSessions();
  }
}

/**
 * Detached backend: the R134 BackgroundProcessRegistry path. A "session" is just an id
 * plus its cwd/env; run() spawns a detached `bash -c` registered under that id, read()
 * is the BashOutput registry read. No keystroke semantics.
 */
export class DetachedTerminalBackend implements TerminalBackend {
  readonly kind = 'detached' as const;
  private readonly sessions = new Map<string, TerminalSessionOptions>();
  constructor(private readonly registry: BackgroundProcessRegistry = BackgroundProcessRegistry.getInstance()) {}

  describe(): string {
    return 'detached backend (BackgroundProcessRegistry, no persistent shell)';
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSession(opts: TerminalSessionOptions): Promise<{ id: string }> {
    const id = `bg-${crypto.randomBytes(4).toString('hex')}`;
    this.sessions.set(id, opts);
    return { id };
  }

  async run(id: string, command: string, opts: TerminalRunOptions = {}): Promise<TerminalRunResult> {
    const session = this.sessions.get(id) ?? {};
    const existing = this.registry.getProcess(id);
    if (existing?.isRunning) {
      throw new Error(`detached session ${id} is still running its previous command; poll BashOutput or KillShell it first`);
    }
    if (existing) this.registry.removeProcess(id);
    const child = spawn('bash', ['-c', command], {
      cwd: session.cwd,
      env: session.env ? { ...process.env, ...session.env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    if (!child.pid) throw new Error('Failed to spawn detached process.');
    this.registry.registerProcess(id, child.pid, command, child);
    child.unref();
    if (opts.block === false) return { output: '', completed: false, exitCode: null };
    const timeoutMs = opts.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    const exit = await new Promise<{ done: boolean; code: number | null }>((resolve) => {
      const timer = setTimeout(() => resolve({ done: false, code: null }), timeoutMs);
      child.on('exit', (code) => { clearTimeout(timer); resolve({ done: true, code }); });
    });
    return { output: await this.read(id), completed: exit.done, timedOut: !exit.done, exitCode: exit.code };
  }

  async sendText(): Promise<void> {
    throw new Error('sendText is not supported by the detached backend (no terminal); use run()');
  }

  async sendKeys(): Promise<void> {
    throw new Error('sendKeys is not supported by the detached backend (no terminal); use KillShell to stop');
  }

  async read(id: string, opts: TerminalReadOptions = {}): Promise<string> {
    const lines = this.registry.getOutput(id);
    const slice = opts.lines && !opts.history ? lines.slice(-opts.lines) : lines;
    return truncateMiddle(slice.join('\n'));
  }

  async waitOutput(id: string, opts: TerminalWaitOptions): Promise<{ matched: boolean; output: string }> {
    const deadline = Date.now() + opts.timeoutMs;
    const re = opts.regex ? new RegExp(opts.regex) : null;
    for (;;) {
      const output = await this.read(id, { history: true });
      if ((re && re.test(output)) || (opts.match && output.includes(opts.match))) return { matched: true, output };
      if (Date.now() >= deadline) return { matched: false, output };
      await new Promise((r) => setTimeout(r, TMUX_POLL_INTERVAL_MS));
    }
  }

  async kill(id: string): Promise<void> {
    this.registry.killProcess(id);
    this.registry.removeProcess(id);
    this.sessions.delete(id);
  }

  async list(): Promise<string[]> {
    return this.registry.getAllProcesses().map((p) => p.shellId);
  }
}

/**
 * Register a BashOutput/KillShell handle for a backend session with no child process
 * (a herdr pane): `refresh` re-pulls the pane text (sentinel lines dropped, exit code
 * captured from the last sentinel), `onKill` is the caller's stop action.
 */
export function registerPaneOutputHandle(
  backend: TerminalBackend,
  sessionId: string,
  bashId: string,
  command: string,
  onKill: () => Promise<void> | void,
  registry: BackgroundProcessRegistry = BackgroundProcessRegistry.getInstance(),
) {
  if (registry.hasProcess(bashId)) return registry.getProcess(bashId)!;
  const handle = registry.registerExternal(bashId, command, {
    refresh: async () => {
      const text = await backend.read(sessionId, { history: true });
      const lines = text.split('\n').filter((l) => l.trim() && !l.includes('__CORTEX_DONE_'));
      handle.output.splice(0, handle.output.length, ...lines);
      const done = text.match(/__CORTEX_DONE_[0-9a-f]+_(\d+)__/g);
      if (done && done.length) {
        const last = done[done.length - 1]!.match(/_(\d+)__$/);
        handle.exitCode = last ? Number(last[1]) : null;
        handle.isRunning = false;
      }
    },
    onKill,
  });
  return handle;
}

export interface ResolveTerminalBackendDeps {
  exec?: BackendExecFn;
  tmux?: TmuxManager;
  warn?: (line: string) => void;
}

let cached: Promise<TerminalBackend> | null = null;

/** Test hook: drop the per-process cache. */
export function resetTerminalBackendCache(): void {
  cached = null;
}

export type TerminalBackendLever = 'auto' | 'herdr' | 'tmux' | 'detached';

export function readTerminalBackendLever(env: NodeJS.ProcessEnv = process.env): TerminalBackendLever {
  const raw = (env.CORTEX_TERMINAL_BACKEND || '').trim().toLowerCase();
  if (raw === 'herdr' || raw === 'tmux' || raw === 'detached') return raw;
  return 'auto';
}

async function resolveUncached(env: NodeJS.ProcessEnv, deps: ResolveTerminalBackendDeps): Promise<TerminalBackend> {
  const lever = readTerminalBackendLever(env);
  const warn = deps.warn ?? ((line: string) => console.warn(line));
  const tmux = deps.tmux ?? TmuxManager.getInstance();

  if (lever === 'auto' || lever === 'herdr') {
    // Reuse the R145 resolver for HERDR_ENV + pane id + binary order; mask the REPORTING
    // lever so turning lifecycle reporting off does not also disable the terminal backend.
    const res = resolveHerdrReporting({ ...env, CORTEX_HERDR_REPORTING: '' });
    if (res.enabled && res.bin && res.paneId) {
      const backend = new HerdrTerminalBackend({ bin: res.bin, parentPaneId: res.paneId, exec: deps.exec, env });
      if (await backend.isAvailable()) return backend;
      if (lever === 'herdr') warn(`[WARN] CORTEX_TERMINAL_BACKEND=herdr but \`herdr pane list\` failed (bin ${res.bin}); falling through to tmux/detached`);
    } else if (lever === 'herdr') {
      warn(`[WARN] CORTEX_TERMINAL_BACKEND=herdr but herdr is unavailable: ${res.reason}; falling through to tmux/detached`);
    }
  }

  if (lever !== 'detached') {
    const backend = new TmuxTerminalBackend(tmux);
    if (await backend.isAvailable()) return backend;
  }

  return new DetachedTerminalBackend();
}

/**
 * Resolve the process-wide terminal backend (cached after the first successful resolution).
 * Pass `env`/`deps` only from tests or explicit callers; the tools call it bare.
 */
export function resolveTerminalBackend(
  env: NodeJS.ProcessEnv = process.env,
  deps: ResolveTerminalBackendDeps = {},
): Promise<TerminalBackend> {
  if (!cached) {
    cached = resolveUncached(env, deps).catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}
