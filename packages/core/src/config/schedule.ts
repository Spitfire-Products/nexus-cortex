/**
 * Schedules for the cortex agent (2026-11-14) — the shared core of `cortex schedule` (CLI) and the IN-SESSION scheduler the TUIs run.
 *
 * Why: the harness had no agent-facing cron / loop / hook, and a team agent must stay responsive with nobody typing. Jobs live in a FILE
 * (~/.cortex/schedules.json) so they survive crashes, restarts and compactions. Two runners share it:
 *   - the OS ticker (launchd / cron → `cortex schedule run-due`): each due job runs headlessly in a fresh session;
 *   - an open TUI (operator 11-14: "First class team member would mean through the tui. not as a subagent"): while a fuzzycortex /
 *     neoncortex window is open it OWNS the schedule — it writes a heartbeat (~/.cortex/schedule-owner.json) and runs due jobs as turns
 *     in ITS OWN session whenever it is idle. The ticker sees a live owner and stands down, so a job never runs twice.
 * mailOnly jobs fire only when the agent has unread mail (no turn, no spend otherwise).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';

export interface ScheduleJob {
  tag: string;            // e.g. "[mail poll]" — unique key
  everyMin: number;       // period in minutes (>= 1)
  prompt: string;         // sent verbatim as the turn's user message
  session?: string;       // ticker: --resume <id>; omitted = a FRESH session per run (--new). The TUI always uses its own session.
  model?: string;
  cwd?: string;           // project the ticker's turn runs in (default: home)
  mailName?: string;      // agent-home mail address for mailOnly (e.g. m2-cortex)
  mailOnly?: boolean;     // fire only when that address has unread mail
  yolo?: boolean;         // ticker: auto-approve tools for this job. In a TUI the session's own approval mode applies.
  enabled?: boolean;
  lastRunMs?: number;
  lastRc?: number;
  lastRunner?: string;    // 'ticker' | 'tui:<pid>'
}

const cortexDir = (): string => path.join(process.env.CORTEX_HOME || os.homedir(), '.cortex');
export function schedulesFile(): string { return path.join(cortexDir(), 'schedules.json'); }
export function scheduleOwnerFile(): string { return path.join(cortexDir(), 'schedule-owner.json'); }

export function loadJobs(file = schedulesFile()): ScheduleJob[] {
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(d?.jobs) ? d.jobs : []; } catch { return []; }
}

export function saveJobs(file: string, jobs: ScheduleJob[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ jobs }, null, 1) + '\n'); fs.renameSync(tmp, file);   // atomic: a tick never reads half a file
}

export function upsertJob(jobs: ScheduleJob[], j: ScheduleJob): ScheduleJob[] {
  const i = jobs.findIndex((x) => x.tag === j.tag);
  if (i < 0) return [...jobs, j];
  const out = [...jobs]; out[i] = { ...jobs[i], ...j }; return out;
}

export function removeJob(jobs: ScheduleJob[], tag: string): ScheduleJob[] { return jobs.filter((j) => j.tag !== tag); }

/** Due when never run or a full period passed (20 s slack so a 60 s ticker does not slip a period). */
export function dueJobs(jobs: ScheduleJob[], nowMs: number): ScheduleJob[] {
  return jobs.filter((j) => j.enabled !== false && (!j.lastRunMs || nowMs - j.lastRunMs >= Math.max(1, j.everyMin) * 60_000 - 20_000));
}

/** Merge fields into ONE job in the file (re-read first: another runner may have written since). */
export function stampJob(file: string, tag: string, patch: Partial<ScheduleJob>): void {
  saveJobs(file, loadJobs(file).map((x) => (x.tag === tag ? { ...x, ...patch } : x)));
}

/** argv + env for one headless turn. `cortexJs` = this install's bin/cortex.js (absolute: launchd has a minimal PATH). */
export function jobInvocation(j: ScheduleJob, cortexJs: string): { args: string[]; env: Record<string, string> } {
  const args = [cortexJs, '--quiet'];
  // a pinned session resumes it; otherwise EVERY run starts its own fresh session (m2 11-14): continuing "the server's current session"
  // mixed mail turns into whatever a human last ran (battery state), and sessions not started with --new missed the USER.md slot.
  if (j.session) args.push('--resume', j.session); else args.push('--new');
  if (j.model) args.push('-m', j.model);
  args.push(j.prompt);
  // warn, never block: an update-required refusal at every release darkened the m2's mail loop until someone ran cortex update (11-14)
  const env: Record<string, string> = { CORTEX_UPDATE_POLICY: process.env.CORTEX_UPDATE_POLICY || 'warn' };
  if (j.yolo) env.YOLO = 'true';
  return { args, env };
}

/** Does `peek` output (mail.py read --peek) show unread mail? */
export const hasUnreadMail = (out: string): boolean => { const t = (out || '').trim(); return !!t && !/^no new mail/i.test(t); };

/** mailOnly jobs pass only when `peek` (mail.py read --peek as the job's address) shows mail. Other jobs always pass. */
export function mailGate(j: ScheduleJob, peek: (mailName: string) => string): boolean {
  return !j.mailOnly || hasUnreadMail(peek(j.mailName || ''));
}

/** Async mail peek (never blocks a TUI render loop). '' when agent-home is not on this machine or the peek fails. */
export function peekMailAsync(addr: string, timeoutMs = 90_000): Promise<string> {
  const mail = path.join(os.homedir(), 'agent-home', 'scripts', 'mail.py');
  if (!fs.existsSync(mail)) return Promise.resolve('');
  return new Promise((resolve) => {
    execFile('python3', [mail, 'read', '--peek'], { encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, ...(addr ? { AGENT_HOME_MAIL_NAME: addr } : {}) } },
      (_err, stdout) => resolve(String(stdout || '').trim()));
  });
}

/** One tick at a time (a turn can outlast the 60 s period). Returns a release fn, or null when another live tick holds it. */
export function acquireTickLock(lockFile: string, staleMs = 3 * 60 * 60_000): (() => void) | null {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const take = () => { const fd = fs.openSync(lockFile, 'wx'); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); return () => { try { fs.rmSync(lockFile); } catch { /* gone */ } }; };
  try { return take(); } catch {
    try {
      const st = fs.statSync(lockFile);
      if (Date.now() - st.mtimeMs > staleMs) { fs.rmSync(lockFile, { force: true }); return take(); }
    } catch { /* raced */ }
    return null;
  }
}

// ── schedule ownership: an open TUI runs the jobs, the OS ticker stands down ─────────────────────────────────────────────────────────
export interface ScheduleOwner { pid: number; host: string; ui: string; sessionId?: string; ts: number }
/** A heartbeat older than this means the TUI is gone (crash, sleep) and the ticker takes over again. */
export const OWNER_STALE_MS = 150_000;

const pidAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

export function readScheduleOwner(file = scheduleOwnerFile()): ScheduleOwner | null {
  try { const o = JSON.parse(fs.readFileSync(file, 'utf8')); return o && typeof o.pid === 'number' ? o : null; } catch { return null; }
}

/** The owner when one is live: fresh heartbeat AND (same host → its pid is alive). Null otherwise. */
export function liveScheduleOwner(nowMs = Date.now(), file = scheduleOwnerFile()): ScheduleOwner | null {
  const o = readScheduleOwner(file);
  if (!o || nowMs - o.ts > OWNER_STALE_MS) return null;
  if (o.host === os.hostname() && !pidAlive(o.pid)) return null;
  return o;
}

/** Write (or refresh) this process's ownership. Refuses (false) when ANOTHER live process owns it — first TUI wins. */
export function claimScheduleOwner(info: { ui: string; sessionId?: string }, nowMs = Date.now(), file = scheduleOwnerFile()): boolean {
  const cur = liveScheduleOwner(nowMs, file);
  if (cur && !(cur.pid === process.pid && cur.host === os.hostname())) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, host: os.hostname(), ui: info.ui, ...(info.sessionId ? { sessionId: info.sessionId } : {}), ts: nowMs } satisfies ScheduleOwner) + '\n');
  fs.renameSync(tmp, file);
  return true;
}

export function releaseScheduleOwner(file = scheduleOwnerFile()): void {
  const o = readScheduleOwner(file);
  if (o && o.pid === process.pid && o.host === os.hostname()) { try { fs.rmSync(file); } catch { /* gone */ } }
}

// ── the in-session scheduler (a TUI runs it) ────────────────────────────────────────────────────────────────────────────────────────
export interface InSessionSchedulerHooks {
  /** true when no turn is running, no dialog is open and the input box is empty. */
  isIdle: () => boolean;
  /** ms epoch of the user's last keystroke (a job never starts while someone is typing). */
  lastUserActivityMs: () => number;
  /** Submit the prompt as a turn in the open session; resolve when the turn ends (reject = the turn failed). */
  runTurn: (prompt: string, job: ScheduleJob) => Promise<void>;
  sessionId?: () => string | undefined;
  /** One-line notices for the transcript / status bar (never the prompt text of a secret job). */
  notify?: (line: string) => void;
}
export interface InSessionSchedulerOptions {
  ui: string;                 // 'fuzzycortex' | 'neoncortex'
  tickMs?: number;            // default 30 s
  idleGraceMs?: number;       // the user must have been quiet this long (default 60 s)
  file?: string; ownerFile?: string;
  peek?: (mailName: string) => Promise<string>;
  now?: () => number;
}

/** Marker every scheduled turn starts with, so the transcript (and the agent) can tell a scheduled turn from a typed one. */
export const scheduledTurnPrompt = (j: ScheduleJob): string => `[scheduled ${j.tag}] ${j.prompt}`;

export class InSessionScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private owning = false;
  private readonly o: Required<Omit<InSessionSchedulerOptions, 'file' | 'ownerFile'>> & { file: string; ownerFile: string };
  constructor(private readonly h: InSessionSchedulerHooks, opts: InSessionSchedulerOptions) {
    this.o = { tickMs: 30_000, idleGraceMs: 60_000, peek: peekMailAsync, now: Date.now, file: schedulesFile(), ownerFile: scheduleOwnerFile(), ...opts } as any;
  }
  /** Starts ticking. Off with CORTEX_TUI_SCHEDULER=off (the OS ticker keeps running the jobs headlessly then). */
  start(): void {
    if (this.timer || (process.env.CORTEX_TUI_SCHEDULER || '').toLowerCase() === 'off') return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.o.tickMs);
    (this.timer as any).unref?.();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; if (this.owning) releaseScheduleOwner(this.o.ownerFile); this.owning = false; }
  get owns(): boolean { return this.owning; }

  /** One tick: refresh the heartbeat, then run at most ONE due job when idle. Exposed for tests. */
  async tick(): Promise<'not-owner' | 'busy' | 'none' | string> {
    const now = this.o.now();
    const owned = claimScheduleOwner({ ui: this.o.ui, sessionId: this.h.sessionId?.() }, now, this.o.ownerFile);
    if (owned && !this.owning) this.h.notify?.(`schedule: this ${this.o.ui} window runs your scheduled jobs while it is open`);
    this.owning = owned;
    if (!owned) return 'not-owner';
    if (this.running || !this.h.isIdle() || now - this.h.lastUserActivityMs() < this.o.idleGraceMs) return 'busy';
    const due = dueJobs(loadJobs(this.o.file), now);
    for (const j of due) {
      if (j.mailOnly && !hasUnreadMail(await this.o.peek(j.mailName || ''))) continue;
      // re-check after the (slow) peek: the user may have started typing or a turn may have begun
      if (this.running || !this.h.isIdle() || this.o.now() - this.h.lastUserActivityMs() < this.o.idleGraceMs) return 'busy';
      this.running = true;
      stampJob(this.o.file, j.tag, { lastRunMs: this.o.now(), lastRunner: `tui:${process.pid}` });   // stamp BEFORE: a crash never re-fires in a loop
      this.h.notify?.(`schedule: running ${j.tag}`);
      let rc = 0;
      try { await this.h.runTurn(scheduledTurnPrompt(j), j); } catch { rc = 1; }
      finally { this.running = false; }
      stampJob(this.o.file, j.tag, { lastRc: rc });
      return j.tag;
    }
    return 'none';
  }
}
