/**
 * herdrReporter — R145 HB-HERDR-LIFECYCLE.
 *
 * When the harness runs inside a herdr-managed pane (HERDR_ENV=1, `herdr` on PATH),
 * the orchestrator reports its lifecycle to herdr so herdr's working/idle/blocked
 * status is authoritative for nexus-cortex (waits, notifications, rollups).
 *
 * Wire shape (herdr 0.9.0, verified against `herdr pane report-agent --help` and
 * `herdr api schema --json` — `pane.report_agent` requires `pane_id`; the CLI takes
 * it as a positional and does NOT accept `--current` on report-agent):
 *
 *   herdr pane report-agent <pane-id> --source custom:nexus-cortex --agent <name> --state <state>
 *   herdr pane report-metadata <pane-id> --source custom:nexus-cortex-display --token summary=<token>
 *
 * The pane id comes from HERDR_PANE_ID (exported into every herdr pane).
 *
 * Contract: fire-and-forget (detached spawn, stdio ignored), never throws, never
 * awaited on the request path, de-duplicated, throttled (min 250 ms, latest wins),
 * one [WARN] then self-disable when the binary fails.
 */

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export type HerdrState = 'working' | 'idle' | 'blocked';

export const HERDR_SOURCE = 'custom:nexus-cortex';
export const HERDR_DISPLAY_SOURCE = 'custom:nexus-cortex-display';
export const HERDR_MIN_INTERVAL_MS = 250;
const DEFAULT_AGENT_NAME = 'cortex';
const SUMMARY_MAX_LEN = 64;

export type HerdrExecFn = (binary: string, args: string[], onError: (err: Error) => void) => void;

export interface HerdrReportingResolution {
  enabled: boolean;
  reason?: string;
  binary?: string;
  paneId?: string;
  agentName?: string;
}

/** Executable-file probe (mirrors TmuxManager's isExecutable — explicit paths only, no directory scans). */
export function isExecutableFile(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    const stats = statSync(path);
    return stats.isFile() && !!(stats.mode & 0o111);
  } catch {
    return false;
  }
}

/** herdr agent names: `[a-z][a-z0-9_-]{0,31}` (herdr SKILL.md). */
export function sanitizeHerdrAgentName(raw: string | undefined): string {
  const cleaned = (raw || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  const name = cleaned.replace(/^[^a-z]+/, '').slice(0, 32);
  return name || DEFAULT_AGENT_NAME;
}

/** Display token value: single token, no whitespace, bounded. */
export function sanitizeHerdrSummary(raw: string): string {
  return raw.trim().replace(/\s+/g, '_').slice(0, SUMMARY_MAX_LEN);
}

/**
 * Enabled iff CORTEX_HERDR_REPORTING !== 'false', HERDR_ENV === '1', HERDR_PANE_ID is set,
 * and `herdr` resolves (HERDR_BIN, else each PATH entry). Never scans /nix/store.
 */
export function resolveHerdrReporting(
  env: NodeJS.ProcessEnv = process.env,
  isExecutable: (path: string) => boolean = isExecutableFile,
): HerdrReportingResolution {
  if ((env.CORTEX_HERDR_REPORTING || '').trim().toLowerCase() === 'false') {
    return { enabled: false, reason: 'CORTEX_HERDR_REPORTING=false' };
  }
  if (env.HERDR_ENV !== '1') {
    return { enabled: false, reason: 'HERDR_ENV is not 1 (not inside a herdr pane)' };
  }
  const paneId = (env.HERDR_PANE_ID || '').trim();
  if (!paneId) {
    return { enabled: false, reason: 'HERDR_PANE_ID unset (herdr report-agent needs the pane id)' };
  }
  let binary: string | undefined;
  const override = (env.HERDR_BIN || '').trim();
  if (override && isExecutable(override)) {
    binary = override;
  } else {
    for (const dir of (env.PATH || '').split(delimiter)) {
      if (!dir) continue;
      const candidate = join(dir, 'herdr');
      if (isExecutable(candidate)) { binary = candidate; break; }
    }
  }
  if (!binary) {
    return { enabled: false, reason: 'herdr binary not found on PATH' };
  }
  return { enabled: true, binary, paneId, agentName: sanitizeHerdrAgentName(env.CORTEX_HERDR_AGENT_NAME) };
}

const defaultExec: HerdrExecFn = (binary, args, onError) => {
  const child = spawn(binary, args, { detached: true, stdio: 'ignore' });
  child.on('error', onError);
  child.unref();
};

export interface HerdrReporterOptions {
  binary: string;
  paneId: string;
  agentName?: string;
  exec?: HerdrExecFn;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout;
  warn?: (line: string) => void;
  minIntervalMs?: number;
}

export class HerdrReporter {
  private readonly binary: string;
  private readonly paneId: string;
  private readonly agentName: string;
  private readonly exec: HerdrExecFn;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  private readonly warn: (line: string) => void;
  private readonly minIntervalMs: number;

  private lastEmitAt = -Infinity;
  private lastState: HerdrState | null = null;
  private lastSummary: string | null = null;
  private pending: { state: HerdrState; summary?: string } | null = null;
  private timerArmed = false;
  public disabled = false;

  constructor(opts: HerdrReporterOptions) {
    this.binary = opts.binary;
    this.paneId = opts.paneId;
    this.agentName = sanitizeHerdrAgentName(opts.agentName);
    this.exec = opts.exec || defaultExec;
    this.now = opts.now || Date.now;
    this.setTimer = opts.setTimer || ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; });
    this.warn = opts.warn || ((line) => console.warn(line));
    this.minIntervalMs = opts.minIntervalMs ?? HERDR_MIN_INTERVAL_MS;
  }

  /** Fire-and-forget lifecycle report. Never throws. */
  report(state: HerdrState, summary?: string): void {
    if (this.disabled) return;
    try {
      const clean = summary !== undefined ? sanitizeHerdrSummary(summary) : undefined;
      const elapsed = this.now() - this.lastEmitAt;
      if (elapsed >= this.minIntervalMs && !this.timerArmed) {
        this.emit(state, clean);
        return;
      }
      // Throttled: coalesce to the latest, flush when the window closes.
      this.pending = { state, summary: clean };
      if (!this.timerArmed) {
        this.timerArmed = true;
        this.setTimer(() => this.flush(), Math.max(0, this.minIntervalMs - elapsed));
      }
    } catch (err) {
      this.disable(err);
    }
  }

  private flush(): void {
    this.timerArmed = false;
    const p = this.pending;
    this.pending = null;
    if (!p || this.disabled) return;
    try {
      this.emit(p.state, p.summary);
    } catch (err) {
      this.disable(err);
    }
  }

  private emit(state: HerdrState, summary: string | undefined): void {
    const stateChanged = state !== this.lastState;
    const summaryChanged = summary !== undefined && summary !== this.lastSummary;
    if (!stateChanged && !summaryChanged) return; // dedupe
    this.lastEmitAt = this.now();
    if (stateChanged) {
      this.lastState = state;
      this.exec(this.binary, ['pane', 'report-agent', this.paneId, '--source', HERDR_SOURCE, '--agent', this.agentName, '--state', state], (err) => this.disable(err));
    }
    if (summaryChanged && !this.disabled) {
      this.lastSummary = summary!;
      this.exec(this.binary, ['pane', 'report-metadata', this.paneId, '--source', HERDR_DISPLAY_SOURCE, '--token', `summary=${summary}`], (err) => this.disable(err));
    }
  }

  private disable(err: unknown): void {
    if (this.disabled) return;
    this.disabled = true;
    this.pending = null;
    const msg = err instanceof Error ? err.message : String(err);
    try { this.warn(`[WARN] herdr lifecycle reporting disabled: ${msg}`); } catch { /* never throw */ }
  }
}
